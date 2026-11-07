"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { requireOwner } from "@/lib/require-role";
import { getMyStaffId } from "@/lib/job-access";
import { parseKind, templateReady, type Template } from "@/lib/campaigns";
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
