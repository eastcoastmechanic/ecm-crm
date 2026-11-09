import { supabase } from "@/lib/supabase";
import { resend, RESEND_FROM_EMAIL, RESEND_REPLY_TO } from "@/lib/resend";
import { sendSMS } from "@/lib/sms";
import { canText } from "@/lib/sms-consent";
import type { CustomerContact, PropertyInfo } from "@/lib/job-lifecycle";

/**
 * "Your technician is on the way" to the job's customer: email if they have one, text only
 * with sms_consent and canText. Used by On my way on the Jobs page and the truck screen.
 */
export async function sendOnWayNotice(jobId: string): Promise<void> {
  const { data: job } = await supabase
    .from("jobs")
    .select("customers(name, email, phone, sms_consent), properties(address)")
    .eq("id", jobId)
    .single();

  const customer = job?.customers as unknown as CustomerContact;
  const property = job?.properties as unknown as PropertyInfo;
  const message = `Hi ${customer?.name ?? ""}, your East Coast Mechanical technician is on the way${
    property?.address ? ` to ${property.address}` : ""
  }!`;

  if (customer?.email) {
    await resend.emails.send({
      from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
      replyTo: RESEND_REPLY_TO,
      to: customer.email,
      subject: "Your technician is on the way",
      text: message,
    });
  }

  if (customer?.phone && customer?.sms_consent && (await canText(customer.phone))) {
    const sent = await sendSMS(customer.phone, message);
    if (!sent.ok) console.error(`On-the-way text failed: ${sent.error}`);
  }
}
