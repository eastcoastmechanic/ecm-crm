"use server";

import { redirect } from "next/navigation";
import { resolveCustomerPropertyEquipment } from "@/lib/customer-intake";
import { supabase } from "@/lib/supabase";
import { notifyOwnerOfWebLead } from "@/lib/notify-owner";
import { noteJobStep } from "@/lib/planner-connector";
import { etDateAtHour, etDateKey } from "@/lib/tz";
import { COMPANY_PHONE_DISPLAY } from "@/lib/brand";
import { bookingConsentPlan, smsOptInState, startDoubleOptIn, type SmsOptInState } from "@/lib/sms-consent";
import {
  LIMITS,
  OPT_IN_TEXTS_KEY,
  RATE_LIMITED_MESSAGE,
  allowAll,
  rateKey,
  requestIp,
  rule,
} from "@/lib/rate-limit-db";

const WINDOW_HOURS: Record<string, number> = {
  morning: 8,
  afternoon: 12,
  evening: 16,
};

export type BookState = { error?: string } | null;

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();

/**
 * Website booking form. Returns { error } for anything the customer can fix, so
 * the form stays filled in, instead of throwing (a thrown error shows a blank
 * "something went wrong" page and loses what they typed).
 */
export async function bookService(_prev: BookState, formData: FormData): Promise<BookState> {
  // Hidden field people never see. Bots fill every box; pretend it worked.
  if (text(formData, "company_website")) redirect("/book?success=1");

  const name = text(formData, "name");
  const phone = text(formData, "phone");
  const email = text(formData, "email") || null;
  const address = text(formData, "address");
  const serviceType = text(formData, "service_type");
  const date = text(formData, "date");
  const window = text(formData, "window");
  const notes = text(formData, "notes");
  const smsConsent = formData.get("sms_consent") === "on";

  if (!name) return { error: "Please enter your name." };
  if (phone.replace(/\D/g, "").length < 10) return { error: "Please enter a phone number we can reach you at." };
  if (!address) return { error: "Please enter the service address." };
  if (!serviceType) return { error: "Please pick a service type." };
  // The window is New York time; the server clock is UTC.
  const scheduledAt = date ? etDateAtHour(date, WINDOW_HOURS[window] ?? 8) : null;
  if (!scheduledAt) return { error: "Please pick a preferred date." };
  if (date < etDateKey()) return { error: "That date has passed. Please pick today or a later day." };

  // Honeypot alone doesn't stop a script. Cap per visitor and per phone number.
  const allowed = await allowAll([
    rule(rateKey("book", "ip", await requestIp()), LIMITS.bookPerIp),
    rule(rateKey("book", "phone", phone), LIMITS.bookPerPhone),
  ]);
  if (!allowed) return { error: RATE_LIMITED_MESSAGE };

  const description = notes ? `${serviceType} — ${notes}` : serviceType;
  const sorry = `Sorry, we couldn't save your request. Please try again, or call us at ${COMPANY_PHONE_DISPLAY}.`;

  // The text box starts a double opt-in; it never sets consent on its own,
  // because anyone can type anyone's number here (see bookingConsentPlan).
  let optInState: SmsOptInState = "none";
  if (smsConsent) {
    try {
      optInState = await smsOptInState(phone);
    } catch (err) {
      console.error("bookService: opt-in lookup failed", err instanceof Error ? err.message : err);
      optInState = "opted_out"; // can't tell, so no consent and no text
    }
  }
  const consentPlan = bookingConsentPlan(smsConsent, optInState);

  let newJobId: string | null = null;
  try {
    const { customerId, propertyId } = await resolveCustomerPropertyEquipment({
      customerName: name,
      phone,
      email,
      smsConsent: consentPlan.consentNow,
      address,
    });

    const { data: newJob, error } = await supabase
      .from("jobs")
      .insert({
        customer_id: customerId,
        property_id: propertyId,
        scheduled_at: scheduledAt.toISOString(),
        status: "requested",
        created_via: "web_form",
        notes: description,
      })
      .select("id")
      .single();
    if (error) {
      console.error("bookService: job insert failed", error.message);
      return { error: sorry };
    }
    newJobId = (newJob?.id as string | undefined) ?? null;
  } catch (err) {
    console.error("bookService failed", err instanceof Error ? err.message : err);
    return { error: sorry };
  }

  // The request is saved; a failed "Reply YES" text or owner email shouldn't make the customer retry.
  // The "Reply YES" text shares the website's hourly cap on confirmation texts.
  // Over the cap the booking still goes through; the customer just isn't
  // texted (they were saved without consent anyway).
  const textAllowed =
    consentPlan.askToConfirm && (await allowAll([rule(OPT_IN_TEXTS_KEY, LIMITS.optInTextsGlobal)]));
  if (consentPlan.askToConfirm && !textAllowed) {
    console.error("bookService: hourly cap on confirmation texts reached, opt-in text skipped");
  }
  if (textAllowed) {
    try {
      const sent = await startDoubleOptIn(phone, name);
      if (sent === "failed") console.error("bookService: opt-in text failed to send");
    } catch (err) {
      console.error("bookService: opt-in request failed", err instanceof Error ? err.message : err);
    }
  }

  try {
    await notifyOwnerOfWebLead({
      source: "web_form",
      customerName: name,
      phone,
      address,
      description,
      scheduledAt,
    });
  } catch (err) {
    console.error("bookService: owner alert failed", err instanceof Error ? err.message : err);
  }

  // A card on the Jobs plan, labelled Lead + Website. Never throws.
  if (newJobId) await noteJobStep(newJobId, "requested");

  redirect("/book?success=1");
}
