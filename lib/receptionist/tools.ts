import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { supabase } from "@/lib/supabase";
import { resolveCustomerPropertyEquipment } from "@/lib/customer-intake";
import { etDayRange, formatEtDateTime, parseEtLocal } from "@/lib/tz";
import { applyJobStatus } from "@/lib/job-lifecycle";
import { notifyOwnerOfReceptionistRequest } from "@/lib/notify-owner";
import { notifyTech } from "@/lib/tech-notice-send";
import { BUSINESS_HOURS } from "./config";
import { openHoursFor, weekdayOf } from "./availability";

// Jobs a caller may move. Finished, cancelled and under-way jobs are refused.
const RESCHEDULABLE = new Set(["requested", "scheduled"]);

// All dates and times the receptionist hears or says are New York time. The
// server clock is UTC, so nothing here uses new Date(y, m, d, h) or getHours().

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

// Channel-agnostic — doesn't depend on caller identity, so it's shared by
// the SMS/voice receptionist and the website chatbot rather than rebuilt
// per channel.
export const checkAvailabilityTool = betaZodTool({
  name: "check_availability",
  description:
    "Check job availability for a given date (YYYY-MM-DD) during business hours. Returns booked time slots and open time slots so you can offer real options to the caller. Times are New York time.",
  inputSchema: z.object({
    date: z.string().describe("Date to check, format YYYY-MM-DD"),
  }),
  run: async ({ date }) => {
    if (!DATE_KEY.test(date)) return `Couldn't read "${date}" as a date. Use YYYY-MM-DD.`;
    if (!BUSINESS_HOURS.daysOfWeek.includes(weekdayOf(date))) {
      return "That date is outside business hours (Mon-Fri). Offer the caller a weekday instead.";
    }

    const { start, end } = etDayRange(date);
    const { data: jobs } = await supabase
      .from("jobs")
      .select("scheduled_at")
      .gte("scheduled_at", start.toISOString())
      .lt("scheduled_at", end.toISOString())
      .in("status", ["requested", "scheduled", "in_progress"]);

    const { openHours, busyCount } = openHoursFor((jobs ?? []).map((j) => j.scheduled_at as string));
    return JSON.stringify({ date, openHours, busyCount });
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
      "Get the caller's upcoming jobs, if they are a known/matched customer. Use this to answer questions like 'when's my appointment'. Use the `when` field (New York time) when telling the caller a time.",
    inputSchema: z.object({}),
    run: async () => {
      if (!customerId) return "This caller is not a recognized customer yet.";
      const { data: jobs } = await supabase
        .from("jobs")
        .select("id, scheduled_at, status, properties(address)")
        .eq("customer_id", customerId)
        .in("status", ["requested", "scheduled", "in_progress"])
        .order("scheduled_at", { ascending: true });
      return JSON.stringify(
        (jobs ?? []).map((j) => ({
          ...j,
          when: j.scheduled_at ? `${formatEtDateTime(j.scheduled_at as string)} ET` : "not scheduled yet",
        }))
      );
    },
  });

  const createJobRequest = betaZodTool({
    name: "create_job_request",
    description:
      "Propose a new job booking. This creates a REQUEST pending owner confirmation, not a final booking — always tell the caller it's pending confirmation. If the caller is not a recognized customer, customerName is required to create their record.",
    inputSchema: z.object({
      date: z.string().describe("Date, format YYYY-MM-DD"),
      time: z.string().describe("Time, 24-hour format HH:MM, New York time"),
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

      // Checked before anything is saved, so a bad time never leaves a customer with no job.
      const scheduledAt = parseEtLocal(`${date}T${time}`);
      if (!scheduledAt) return `Couldn't read "${date} ${time}" as a date and time. Use YYYY-MM-DD and HH:MM.`;

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

      const { data: newJob, error: jobError } = await supabase
        .from("jobs")
        .insert({
          customer_id: finalCustomerId,
          property_id: propertyId,
          scheduled_at: scheduledAt.toISOString(),
          status: "requested",
          created_via: createdVia,
          notes: description,
        })
        .select("id")
        .single();
      if (jobError || !newJob) return `Failed to create job request: ${jobError?.message ?? "no job saved"}`;

      // Pending until the office confirms, so make sure Josh sees it.
      await notifyOwnerOfReceptionistRequest({ kind: "new", jobId: newJob.id as string, channel: createdVia });

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
      newTime: z.string().describe("New time, 24-hour format HH:MM, New York time"),
    }),
    run: async ({ jobId, newDate, newTime }) => {
      if (!customerId) return "Cannot reschedule: caller is not a recognized customer.";

      const scheduledAt = parseEtLocal(`${newDate}T${newTime}`);
      if (!scheduledAt) return `Couldn't read "${newDate} ${newTime}" as a date and time. Use YYYY-MM-DD and HH:MM.`;

      const { data: job } = await supabase
        .from("jobs")
        .select("id, customer_id, status, scheduled_at, assigned_staff_id")
        .eq("id", jobId)
        .single();
      if (!job || job.customer_id !== customerId) {
        return "That job was not found for this customer.";
      }
      // A finished or cancelled job can't be moved, and a job the tech is already
      // working is the office's call, not the receptionist's.
      if (!RESCHEDULABLE.has(job.status as string)) {
        return job.status === "in_progress"
          ? "That job is already under way, so it can't be moved here. Tell the caller the office will call them back."
          : "That job is already finished or cancelled, so it can't be moved. Offer to book a new visit instead.";
      }

      // Only while the job is still open, in case it closed since the read above.
      const { data: moved, error } = await supabase
        .from("jobs")
        .update({ scheduled_at: scheduledAt.toISOString(), created_via: createdVia })
        .eq("id", jobId)
        .in("status", [...RESCHEDULABLE])
        .select("id");
      if (error) return `Failed to reschedule: ${error.message}`;
      if (!moved || moved.length === 0) return "That job can't be moved any more. Tell the caller the office will call them back.";

      // Back to pending through the lifecycle, so the calendar and Planner sync see it.
      try {
        await applyJobStatus(jobId, "requested", { onlyFrom: job.status as string });
      } catch (err) {
        console.error(`[receptionist] could not set job ${jobId} back to requested:`, err);
      }

      await notifyOwnerOfReceptionistRequest({
        kind: "reschedule",
        jobId,
        channel: createdVia,
        previousAt: (job.scheduled_at as string | null) ?? null,
      });
      await notifyTech({ jobId, staffId: (job.assigned_staff_id as string | null) ?? null, kind: "rescheduled" });

      return `Reschedule requested for ${newDate} at ${newTime}, pending confirmation from East Coast Mechanical.`;
    },
  });

  return [checkAvailabilityTool, getCustomerJobs, createJobRequest, rescheduleJobRequest];
}
