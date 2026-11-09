"use server";

import { redirect } from "next/navigation";
import { resend, RESEND_FROM_EMAIL } from "@/lib/resend";
import { COMPANY_PHONE_DISPLAY } from "@/lib/brand";
import { LIMITS, RATE_LIMITED_MESSAGE, allowAll, rateKey, requestIp, rule } from "@/lib/rate-limit-db";

const OWNER_EMAIL = process.env.OWNER_EMAIL;

export type ContactState = { error?: string } | null;

const text = (formData: FormData, key: string, max: number) => String(formData.get(key) ?? "").trim().slice(0, max);

/** Website contact form. Returns { error } so the form keeps what was typed. */
export async function sendContactMessage(_prev: ContactState, formData: FormData): Promise<ContactState> {
  // Hidden field people never see. Bots fill every box; pretend it worked.
  if (text(formData, "company_website", 200)) redirect("/contact?success=1");

  const name = text(formData, "name", 200);
  const email = text(formData, "email", 200);
  const message = String(formData.get("message") ?? "").trim();

  if (!name) return { error: "Please enter your name." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Please enter a valid email address." };
  if (!message) return { error: "Please include a message." };
  if (message.length > 5000) return { error: "Please keep the message under 5,000 characters, or call us." };

  // Honeypot alone doesn't stop a script. Cap per visitor and per email address.
  const allowed = await allowAll([
    rule(rateKey("contact", "ip", await requestIp()), LIMITS.contactPerIp),
    rule(rateKey("contact", "email", email), LIMITS.contactPerEmail),
  ]);
  if (!allowed) return { error: RATE_LIMITED_MESSAGE };

  const sorry = `Sorry, your message didn't go through. Please try again, or call us at ${COMPANY_PHONE_DISPLAY}.`;
  // Before, a missing owner address or a failed send still said "thanks" and the message was lost.
  if (!OWNER_EMAIL) {
    console.error("sendContactMessage: OWNER_EMAIL is not set");
    return { error: sorry };
  }
  try {
    const { error } = await resend.emails.send({
      from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
      to: OWNER_EMAIL,
      replyTo: email,
      subject: `Website contact form: ${name}`,
      text: `Name: ${name}\nEmail: ${email}\n\n${message}`,
    });
    if (error) {
      console.error("sendContactMessage: send failed", error.message);
      return { error: sorry };
    }
  } catch (err) {
    console.error("sendContactMessage failed", err instanceof Error ? err.message : err);
    return { error: sorry };
  }

  redirect("/contact?success=1");
}
