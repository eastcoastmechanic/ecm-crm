import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { supabase } from "@/lib/supabase";
import { resolveCustomerPropertyEquipment } from "@/lib/customer-intake";
import { notifyOwnerOfWebLead } from "@/lib/notify-owner";
import { checkAvailabilityTool } from "./tools";

// Unlike the SMS/voice tools, a website visitor is never a "recognized
// customer" (no phone-number channel to match against), so there's no
// get_customer_jobs/reschedule equivalent here — just availability + booking.
const createWebBookingRequest = betaZodTool({
  name: "create_web_booking_request",
  description:
    "Propose a new job booking for a website visitor. This creates a REQUEST pending owner confirmation, not a final booking — always tell the visitor it's pending confirmation. Requires their name, phone, and service address; ask for whatever is missing before calling this.",
  inputSchema: z.object({
    name: z.string().describe("Visitor's full name"),
    phone: z.string().describe("Visitor's phone number"),
    address: z.string().describe("Service address"),
    date: z.string().describe("Date, format YYYY-MM-DD"),
    time: z.string().describe("Time, 24-hour format HH:MM"),
    description: z.string().describe("What the visitor needs done"),
    smsConsent: z
      .boolean()
      .optional()
      .describe(
        "True only if the visitor explicitly agreed when asked whether they'd like text updates about their appointment. Leave unset/false if not asked, unclear, or declined."
      ),
  }),
  run: async ({ name, phone, address, date, time, description, smsConsent }) => {
    let customerId: string;
    let propertyId: string;
    try {
      const resolved = await resolveCustomerPropertyEquipment({
        customerName: name,
        phone,
        smsConsent: smsConsent === true,
        address,
      });
      customerId = resolved.customerId!;
      propertyId = resolved.propertyId!;
    } catch (err) {
      return `Failed to set up customer/property: ${err instanceof Error ? err.message : "unknown error"}`;
    }

    const [year, month, day] = date.split("-").map(Number);
    const [hour, minute] = time.split(":").map(Number);
    const scheduledAt = new Date(year, month - 1, day, hour, minute, 0);

    const { error: jobError } = await supabase.from("jobs").insert({
      customer_id: customerId,
      property_id: propertyId,
      scheduled_at: scheduledAt.toISOString(),
      status: "requested",
      created_via: "web_chat",
      notes: description,
    });
    if (jobError) return `Failed to create job request: ${jobError.message}`;

    await notifyOwnerOfWebLead({
      source: "web_chat",
      customerName: name,
      phone,
      address,
      description,
      scheduledAt,
    });

    return `Job request created for ${date} at ${time}, pending confirmation from East Coast Mechanical.`;
  },
});

export function buildWebChatTools() {
  return [checkAvailabilityTool, createWebBookingRequest];
}
