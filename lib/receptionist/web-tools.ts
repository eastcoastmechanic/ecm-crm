import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { supabase } from "@/lib/supabase";
import { resolveCustomerPropertyEquipment } from "@/lib/customer-intake";
import { notifyOwnerOfWebLead } from "@/lib/notify-owner";
import { checkAvailabilityTool } from "./tools";
import { parseEtLocal } from "@/lib/tz";
import { bookingConsentPlan, smsOptInState, startDoubleOptIn, type SmsOptInState } from "@/lib/sms-consent";
import { LIMITS, OPT_IN_TEXTS_KEY, allowAll, rule } from "@/lib/rate-limit-db";

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
    // The visitor means New York time; the server clock is UTC. Checked before anything is saved.
    const scheduledAt = parseEtLocal(`${date}T${time}`);
    if (!scheduledAt) return `Couldn't read "${date} ${time}" as a date and time. Use YYYY-MM-DD and HH:MM.`;

    // Same rule as /book: a chat visitor can type anyone's number, so "yes, text
    // me" only starts a double opt-in. Consent is saved now only if that number
    // already confirmed (YES or START on file); see bookingConsentPlan.
    const wantsTexts = smsConsent === true;
    let optInState: SmsOptInState = "none";
    if (wantsTexts) {
      try {
        optInState = await smsOptInState(phone);
      } catch (err) {
        console.error("web chat booking: opt-in lookup failed", err instanceof Error ? err.message : err);
        optInState = "opted_out"; // can't tell, so no consent and no text
      }
    }
    const consentPlan = bookingConsentPlan(wantsTexts, optInState);

    let customerId: string;
    let propertyId: string;
    try {
      const resolved = await resolveCustomerPropertyEquipment({
        customerName: name,
        phone,
        smsConsent: consentPlan.consentNow,
        address,
      });
      customerId = resolved.customerId!;
      propertyId = resolved.propertyId!;
    } catch (err) {
      return `Failed to set up customer/property: ${err instanceof Error ? err.message : "unknown error"}`;
    }

    const { error: jobError } = await supabase.from("jobs").insert({
      customer_id: customerId,
      property_id: propertyId,
      scheduled_at: scheduledAt.toISOString(),
      status: "requested",
      created_via: "web_chat",
      notes: description,
    });
    if (jobError) return `Failed to create job request: ${jobError.message}`;

    // The request is saved; a failed "Reply YES" text shouldn't fail the booking.
    // Shares the website's hourly cap on confirmation texts with /sms-signup and
    // /book. Over the cap the booking still goes through, without the text.
    let confirmTextSent = false;
    const textAllowed =
      consentPlan.askToConfirm && (await allowAll([rule(OPT_IN_TEXTS_KEY, LIMITS.optInTextsGlobal)]));
    if (consentPlan.askToConfirm && !textAllowed) {
      console.error("web chat booking: hourly cap on confirmation texts reached, opt-in text skipped");
    }
    if (textAllowed) {
      try {
        const sent = await startDoubleOptIn(phone, name);
        if (sent === "failed") console.error("web chat booking: opt-in text failed to send");
        confirmTextSent = sent === "sent";
      } catch (err) {
        console.error("web chat booking: opt-in request failed", err instanceof Error ? err.message : err);
      }
    }

    await notifyOwnerOfWebLead({
      source: "web_chat",
      customerName: name,
      phone,
      address,
      description,
      scheduledAt,
    });

    const textNote = confirmTextSent
      ? " We texted that number once to confirm text updates; the visitor must reply YES to that text to start getting them."
      : "";
    return `Job request created for ${date} at ${time}, pending confirmation from East Coast Mechanical.${textNote}`;
  },
});

export function buildWebChatTools() {
  return [checkAvailabilityTool, createWebBookingRequest];
}
