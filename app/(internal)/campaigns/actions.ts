"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { requireOwner } from "@/lib/require-role";
import { getMyStaffId } from "@/lib/job-access";
import { emailBody, fill, parseKind, smsBody, templateReady, type Template } from "@/lib/campaigns";
import { sendSMS } from "@/lib/sms";
import { resend, RESEND_FROM_EMAIL, RESEND_REPLY_TO } from "@/lib/resend";
import { COMPANY_NAME } from "@/lib/brand";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://ecm-crm.vercel.app").replace(/\/$/, "");
import { sendCampaign, type SendResult } from "@/lib/campaign-send";

export type TemplateState = { error?: string; saved?: boolean; values?: Template } | null;
export type SendState = { error?: string; result?: SendResult } | null;

async function ownerOnly(): Promise<string | null> {
  try {
    await requireOwner();
    return null;
  } catch {
    return "Only the owner can do this.";
  }
}

const clean = (v: FormDataEntryValue | null, max: number) => String(v ?? "").trim().slice(0, max);

/** Save Josh's wording for one campaign. Echoes the typed values back so an error keeps them. */
export async function saveTemplate(_prev: TemplateState, formData: FormData): Promise<TemplateState> {
  const values: Template = {
    sms_text: clean(formData.get("sms_text"), 640),
    email_subject: clean(formData.get("email_subject"), 200),
    email_body: clean(formData.get("email_body"), 5000),
  };
  const denied = await ownerOnly();
  if (denied) return { error: denied, values };
  const kind = parseKind(formData.get("kind"));
  if (!kind) return { error: "Pick a campaign.", values };

  const { error } = await supabase.from("campaign_templates").upsert({
    kind,
    ...values,
    updated_at: new Date().toISOString(),
    updated_by: await getMyStaffId(),
  });
  if (error) {
    return {
      error: /campaign_templates/i.test(error.message)
        ? "Run db/migrations/0067_campaigns.sql in Supabase first."
        : "Couldn't save. Try again.",
      values,
    };
  }
  revalidatePath("/campaigns");
  return { saved: true, values };
}

/** Send one campaign to everyone on its list right now. The list is rebuilt on the server. */
export async function sendCampaignNow(_prev: SendState, formData: FormData): Promise<SendState> {
  const denied = await ownerOnly();
  if (denied) return { error: denied };
  const kind = parseKind(formData.get("kind"));
  if (!kind) return { error: "Pick a campaign." };
  if (formData.get("confirm") !== "yes") return { error: "Tick the box to confirm before sending." };

  const { data: template, error } = await supabase
    .from("campaign_templates")
    .select("sms_text, email_subject, email_body")
    .eq("kind", kind)
    .maybeSingle();
  if (error) return { error: "Couldn't read the wording. Try again." };
  if (!templateReady(template)) return { error: "Write and save the text and the email first." };

  try {
    const result = await sendCampaign(kind, template as Template);
    revalidatePath("/campaigns");
    return { result };
  } catch {
    return { error: "Sending stopped on an error. Check the list before sending again." };
  }
}

export type TestState = { error?: string; sentTo?: string } | null;

/**
 * Owner-only. Sends the wording as typed (saved or not) to the owner's own
 * phone and email, filled in as if for "Josh". No customer gets anything and
 * it isn't recorded, so it doesn't count toward anyone's 30 days.
 */
export async function sendTestToMe(_prev: TestState, formData: FormData): Promise<TestState> {
  const denied = await ownerOnly();
  if (denied) return { error: denied };
  const kind = parseKind(formData.get("kind"));
  if (!kind) return { error: "Pick a campaign." };
  const sms = clean(formData.get("sms_text"), 640);
  const subject = clean(formData.get("email_subject"), 200);
  const body = clean(formData.get("email_body"), 5000);
  if (!sms && !(subject && body)) return { error: "Write the text or the email first." };

  const phone = process.env.OWNER_PHONE;
  const email = process.env.OWNER_EMAIL;
  const sentTo: string[] = [];
  const problems: string[] = [];

  if (sms) {
    if (!phone) problems.push("OWNER_PHONE isn't set, so no test text");
    else {
      const res = await sendSMS(phone, `[TEST] ${smsBody(sms, "Josh")}`);
      if (res.ok) sentTo.push("your phone");
      else problems.push(`text failed (${res.error ?? "unknown"})`);
    }
  }
  if (subject && body) {
    if (!email) problems.push("OWNER_EMAIL isn't set, so no test email");
    else {
      try {
        const { error } = await resend.emails.send({
          from: `${COMPANY_NAME} <${RESEND_FROM_EMAIL}>`,
          replyTo: RESEND_REPLY_TO,
          to: email,
          subject: `[TEST] ${fill(subject, "Josh")}`,
          text: emailBody(body, "Josh", `${APP_URL}/unsubscribe/test-link-goes-here`),
        });
        if (error) problems.push(`email failed (${error.message})`);
        else sentTo.push("your email");
      } catch {
        problems.push("email failed");
      }
    }
  }

  if (sentTo.length === 0) return { error: problems.join("; ") || "Nothing sent." };
  return { sentTo: sentTo.join(" and ") + (problems.length ? `. Also: ${problems.join("; ")}` : "") };
}
