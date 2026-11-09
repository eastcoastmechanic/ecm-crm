"use server";

import { redirect } from "next/navigation";
import { phoneKey } from "@/lib/phone";
import { startDoubleOptIn } from "@/lib/sms-consent";
import { COMPANY_PHONE_DISPLAY } from "@/lib/brand";
import {
  LIMITS,
  OPT_IN_TEXTS_KEY,
  RATE_LIMITED_MESSAGE,
  allowAll,
  rateKey,
  requestIp,
  rule,
} from "@/lib/rate-limit-db";

export type SignupState = { error?: string } | null;

// Double opt-in: the form only records a pending request and texts the number.
// Consent (customers.sms_consent / sms_optins) is written only when the owner
// of that number replies YES -- see handleSmsKeyword in lib/sms-consent.ts.
// Returns { error } so the visitor sees the reason (a thrown message is hidden in production).
export async function signUpForSms(_prev: SignupState, formData: FormData): Promise<SignupState> {
  const name = String(formData.get("name") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim();
  const consent = formData.get("consent") === "on";

  if (!phone) return { error: "Please enter your phone number." };
  if (phoneKey(phone).length !== 10) return { error: "Please enter a valid 10-digit phone number." };
  if (!consent) return { error: "Please tick the box to agree to receive text messages." };

  // Each sign-up sends a paid text, so a script feeding in numbers would run up
  // the bill (SMS pumping). Cap per visitor, per number, and for everyone.
  const allowed = await allowAll([
    rule(rateKey("sms-signup", "ip", await requestIp()), LIMITS.smsSignupPerIp),
    rule(rateKey("sms-signup", "phone", phone), LIMITS.smsSignupPerPhone),
    rule(OPT_IN_TEXTS_KEY, LIMITS.optInTextsGlobal),
  ]);
  if (!allowed) return { error: RATE_LIMITED_MESSAGE };

  const sorry = `We couldn't send the confirmation text. Please try again, or call us at ${COMPANY_PHONE_DISPLAY}.`;
  try {
    if ((await startDoubleOptIn(phone, name)) === "failed") return { error: sorry };
  } catch (err) {
    console.error("signUpForSms failed", err instanceof Error ? err.message : err);
    return { error: sorry };
  }

  redirect("/sms-signup?success=1");
}
