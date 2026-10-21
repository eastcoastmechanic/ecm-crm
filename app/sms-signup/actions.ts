"use server";

import { redirect } from "next/navigation";
import { toE164, phoneKey } from "@/lib/phone";
import { sendSMS } from "@/lib/sms";
import { OPT_IN_CONFIRM_REQUEST, requestOptIn } from "@/lib/sms-consent";

// Double opt-in: the form only records a pending request and texts the number.
// Consent (customers.sms_consent / sms_optins) is written only when the owner
// of that number replies YES -- see handleSmsKeyword in lib/sms-consent.ts.
export async function signUpForSms(formData: FormData) {
  const name = (formData.get("name") as string)?.trim() || null;
  const phone = (formData.get("phone") as string)?.trim();
  const consent = formData.get("consent") === "on";

  if (!phone) throw new Error("Phone number is required");
  if (phoneKey(phone).length !== 10) throw new Error("Please enter a valid 10-digit phone number");
  if (!consent) throw new Error("Please check the box to agree to receive text messages");

  const shouldSend = await requestOptIn(phone, name);
  if (shouldSend) {
    const sent = await sendSMS(toE164(phone), OPT_IN_CONFIRM_REQUEST);
    if (!sent.ok) throw new Error("We couldn't send the confirmation text. Please try again or call us.");
  }

  redirect("/sms-signup?success=1");
}
