import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { supabase } from "@/lib/supabase";
import { resolveCustomerPropertyEquipment } from "@/lib/customer-intake";
import { BUSINESS_HOURS, DEFAULT_JOB_DURATION_HOURS } from "./config";

function dayBounds(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const start = new Date(year, month - 1, day, 0, 0, 0);
  const end = new Date(year, month - 1, day, 23, 59, 59);
  return { start, end };
}

// Channel-agnostic — doesn't depend on caller identity, so it's shared by
// the SMS/voice receptionist and the website chatbot rather than rebuilt
// per channel.
export const checkAvailabilityTool = betaZodTool({
  name: "check_availability",
  description:
    "Check job availability for a given date (YYYY-MM-DD) during business hours. Returns booked time slots and open time slots so you can offer real options to the caller.",
  inputSchema: z.object({
    date: z.string().describe("Date to check, format YYYY-MM-DD"),
  }),
  run: async ({ date }) => {
    const { start, end } = dayBounds(date);
    const { data: jobs } = await supabase
      .from("jobs")
      .select("scheduled_at")
      .gte("scheduled_at", start.toISOString())
      .lte("scheduled_at", end.toISOString())
      .in("status", ["requested", "scheduled", "in_progress"]);

    const [year, month, day] = date.split("-").map(Number);
    const weekday = new Date(year, month - 1, day).getDay();
    if (!BUSINESS_HOURS.daysOfWeek.includes(weekday)) {
      return "That date is outside business hours (Mon-Fri). Offer the caller a weekday instead.";
    }

    const busyHours = new Set<number>();
    for (const j of jobs ?? []) {
      const startHour = new Date(j.scheduled_at as string).getHours();
      for (let h = startHour; h < startHour + DEFAULT_JOB_DURATION_HOURS; h++) {
        busyHours.add(h);
      }
    }
    const openHours: string[] = [];
    for (let h = BUSINESS_HOURS.startHour; h < BUSINESS_HOURS.endHour; h++) {
      if (!busyHours.has(h)) openHours.push(`${String(h).padStart(2, "0")}:00`);
    }
    return JSON.stringify({ date, openHours, busyCount: busyHours.size });
  },
});

export function buildReceptionistTools(params: {
  customerId: string | null;
  phoneNumber: string;
  createdVia?: string;
}) {
  const { customerId, phoneNumber, createdVia = "ai_sms" } = params;

  const getCustomerJobs = betaZodTool({
    name: "get_customer_jobs",
    description:
      "Get the caller's upcoming jobs, if they are a known/matched customer. Use this to answer questions like 'when's my appointment'.",
    inputSchema: z.object({}),
    run: async () => {
      if (!customerId) return "This caller is not a recognized customer yet.";
      const { data: jobs } = await supabase
        .from("jobs")
        .select("id, scheduled_at, status, properties(address)")
        .eq("customer_id", customerId)
        .in("status", ["requested", "scheduled", "in_progress"])
        .order("scheduled_at", { ascending: true });
      return JSON.stringify(jobs ?? []);
    },
  });

  const createJobRequest = betaZodTool({
    name: "create_job_request",
    description:
      "Propose a new job booking. This creates a REQUEST pending owner confirmation, not a final booking — always tell the caller it's pending confirmation. If the caller is not a recognized customer, customerName is required to create their record.",
    inputSchema: z.object({
      date: z.string().describe("Date, format YYYY-MM-DD"),
      time: z.string().describe("Time, 24-hour format HH:MM"),
      address: z.string().describe("Service address"),
      description: z.string().describe("What the customer needs done"),
      customerName: z.string().optional().describe("Required only if this is a new/unrecognized caller"),
      smsConsent: z
        .boolean()
        .optional()
        .describe(
          "Phone call channel only: true only if the caller explicitly agreed when asked whether they'd like text updates about their appointment. Leave unset/false if not asked, unclear, or declined."
        ),
    }),
    run: async ({ date, time, address, description, customerName, smsConsent }) => {
      if (!customerId && !customerName) {
        return "Cannot book: this is a new caller and no name was provided. Ask for their name first.";
      }

      // Texting in is itself consent for the SMS channel; for a phone call,
      // only enroll the number if the caller explicitly agreed when asked.
      const finalSmsConsent = createdVia === "ai_sms" ? true : smsConsent === true;

      let finalCustomerId: string;
      let propertyId: string;
      try {
        const resolved = await resolveCustomerPropertyEquipment({
          customerId,
          customerName,
          phone: phoneNumber,
          smsConsent: finalSmsConsent,
          address,
        });
        finalCustomerId = resolved.customerId!;
        propertyId = resolved.propertyId!;
      } catch (err) {
        return `Failed to set up customer/property: ${err instanceof Error ? err.message : "unknown error"}`;
      }

      const [year, month, day] = date.split("-").map(Number);
      const [hour, minute] = time.split(":").map(Number);
      const scheduledAt = new Date(year, month - 1, day, hour, minute, 0);

      const { error: jobError } = await supabase.from("jobs").insert({
        customer_id: finalCustomerId,
        property_id: propertyId,
        scheduled_at: scheduledAt.toISOString(),
        status: "requested",
        created_via: createdVia,
        notes: description,
      });
      if (jobError) return `Failed to create job request: ${jobError.message}`;

      return `Job request created for ${date} at ${time}, pending confirmation from East Coast Mechanical.`;
    },
  });

  const rescheduleJobRequest = betaZodTool({
    name: "reschedule_job_request",
    description:
      "Propose rescheduling an existing job to a new date/time. Only works for jobs belonging to the recognized caller. This re-flags the job as pending owner confirmation.",
    inputSchema: z.object({
      jobId: z.string().describe("The job's id, from get_customer_jobs"),
      newDate: z.string().describe("New date, format YYYY-MM-DD"),
      newTime: z.string().describe("New time, 24-hour format HH:MM"),
    }),
    run: async ({ jobId, newDate, newTime }) => {
      if (!customerId) return "Cannot reschedule: caller is not a recognized customer.";

      const { data: job } = await supabase
        .from("jobs")
        .select("id, customer_id")
        .eq("id", jobId)
        .single();
      if (!job || job.customer_id !== customerId) {
        return "That job was not found for this customer.";
      }

      const [year, month, day] = newDate.split("-").map(Number);
      const [hour, minute] = newTime.split(":").map(Number);
      const scheduledAt = new Date(year, month - 1, day, hour, minute, 0);

      const { error } = await supabase
        .from("jobs")
        .update({ scheduled_at: scheduledAt.toISOString(), status: "requested", created_via: createdVia })
        .eq("id", jobId);
      if (error) return `Failed to reschedule: ${error.message}`;

      return `Reschedule requested for ${newDate} at ${newTime}, pending confirmation from East Coast Mechanical.`;
    },
  });

  return [checkAvailabilityTool, getCustomerJobs, createJobRequest, rescheduleJobRequest];
}
