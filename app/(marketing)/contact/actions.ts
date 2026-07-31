"use server";

import { redirect } from "next/navigation";
import { resend, RESEND_FROM_EMAIL } from "@/lib/resend";

const OWNER_EMAIL = process.env.OWNER_EMAIL;

export async function sendContactMessage(formData: FormData) {
  const name = (formData.get("name") as string)?.trim();
  const email = (formData.get("email") as string)?.trim();
  const message = (formData.get("message") as string)?.trim();

  if (!name) throw new Error("Name is required");
  if (!email) throw new Error("Email is required");
  if (!message) throw new Error("Please include a message");

  if (OWNER_EMAIL) {
    await resend.emails.send({
      from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
      to: OWNER_EMAIL,
      replyTo: email,
      subject: `Website contact form: ${name}`,
      text: `Name: ${name}\nEmail: ${email}\n\n${message}`,
    });
  }

  redirect("/contact?success=1");
}
