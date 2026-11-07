"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { sendSMS } from "@/lib/sms";
import { canText } from "@/lib/sms-consent";
import { resend, RESEND_FROM_EMAIL, RESEND_REPLY_TO } from "@/lib/resend";
import { syncLeadToGraph, deleteLeadFromGraph } from "@/lib/graph-connector";
import { createPlannerTask } from "@/lib/planner-connector";
import { requireOffice } from "@/lib/require-role";

export async function updateLeadDraft(formData: FormData): Promise<{ error?: string }> {
  await requireOffice();
  const id = formData.get("id") as string;
  const draft_message = (formData.get("draft_message") as string) ?? "";

  const { error } = await supabase.from("leads").update({ draft_message }).eq("id", id);
  if (error) return { error: "Couldn't save. Try again." };

  await syncLeadToGraph(id);

  revalidatePath("/leads");
  return {};
}

export async function markContacted(formData: FormData): Promise<{ error?: string }> {
  await requireOffice();
  const id = formData.get("id") as string;

  const { error } = await supabase
    .from("leads")
    .update({ status: "contacted", contacted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: "Couldn't save. Try again." };

  await syncLeadToGraph(id);

  revalidatePath("/leads");
  return {};
}

export async function dismissLead(formData: FormData): Promise<{ error?: string }> {
  await requireOffice();
  const id = formData.get("id") as string;

  const { error } = await supabase
    .from("leads")
    .update({ status: "dismissed", dismissed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: "Couldn't save. Try again." };

  await syncLeadToGraph(id);

  revalidatePath("/leads");
  return {};
}

export async function addManualLead(formData: FormData): Promise<{ error?: string }> {
  await requireOffice();
  const contact_name = (formData.get("contact_name") as string)?.trim();
  const phone_number = (formData.get("phone_number") as string)?.trim() || null;
  const email = (formData.get("email") as string)?.trim() || null;
  const town = (formData.get("town") as string)?.trim() || null;
  const address = (formData.get("address") as string)?.trim() || null;
  const summary = (formData.get("summary") as string)?.trim() || null;
  const urgency_score = Number(formData.get("urgency_score")) || 5;

  if (!contact_name) return { error: "Name is required." };

  const { data: lead, error } = await supabase
    .from("leads")
    .insert({
      source: "manual",
      status: "new",
      channel: "none",
      contact_name,
      phone_number,
      contact_info: email,
      town,
      address,
      summary,
      urgency_score,
      auto_sendable: false,
    })
    .select("id")
    .single();
  if (error) return { error: "Couldn't save. Try again." };

  if (lead) {
    await syncLeadToGraph(lead.id);
    // Manual entry means a human is walking this through the sales pipeline
    // by hand (see 0024_lead_radar_pipeline.sql) -- unlike an automated
    // sweep's draft-and-auto-send leads, this one needs a person to actually
    // do something next, so it gets a Planner card.
    await createPlannerTask({
      title: [contact_name, town].filter(Boolean).join(" — ") || "New lead",
      notes: summary ?? undefined,
      bucket: "tasks",
    });
  }

  revalidatePath("/leads");
  return {};
}

const LEAD_STAGES = ["new", "contacted", "quoted", "won", "lost", "sent", "dismissed"];

/** Move a lead to a stage. Returns { error } so the board can put the card back if the save fails. */
export async function setLeadStage(formData: FormData): Promise<{ error?: string }> {
  await requireOffice();
  const id = String(formData.get("id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  if (!id) return { error: "Lead is required." };
  if (!LEAD_STAGES.includes(status)) return { error: "Pick a stage." };

  const update: Record<string, unknown> = { status };
  if (status === "contacted") update.contacted_at = new Date().toISOString();
  if (status === "lost") update.dismissed_at = new Date().toISOString();

  const { error } = await supabase.from("leads").update(update).eq("id", id);
  if (error) return { error: "Couldn't save the stage. Try again." };

  await syncLeadToGraph(id);

  revalidatePath("/leads");
  return {};
}

/** Echoes what was typed so the form keeps it after an error (React resets uncontrolled fields). */
export type LeadFollowUpState = { error?: string; saved?: boolean; nextStep?: string; followUpOn?: string } | null;

/** Set or clear a lead's next step and follow-up date (SQL 0061). Problems come back inline. */
export async function setLeadFollowUp(_prev: LeadFollowUpState, formData: FormData): Promise<LeadFollowUpState> {
  await requireOffice();
  const id = String(formData.get("id") ?? "").trim();
  const nextStep = String(formData.get("next_step") ?? "").trim().slice(0, 300);
  const followUpOn = String(formData.get("follow_up_on") ?? "").trim();
  const typed = { nextStep, followUpOn };
  if (!id) return { error: "Lead is required.", ...typed };
  if (followUpOn && !/^\d{4}-\d{2}-\d{2}$/.test(followUpOn)) return { error: "Pick a valid date.", ...typed };

  const { error } = await supabase
    .from("leads")
    .update({ next_step: nextStep || null, follow_up_on: followUpOn || null })
    .eq("id", id);
  if (error) {
    // Before SQL 0061 is run the columns don't exist yet.
    if (/next_step|follow_up_on/.test(error.message)) return { error: "Run SQL 0061 first (lead follow-up columns).", ...typed };
    return { error: "Couldn't save the follow-up. Try again.", ...typed };
  }

  revalidatePath("/leads");
  return { saved: true };
}

export async function deleteLead(id: string): Promise<{ error?: string }> {
  await requireOffice();
  const { error } = await supabase.from("leads").delete().eq("id", id);
  if (error) return { error: error.message };

  await deleteLeadFromGraph(id);

  revalidatePath("/leads");
  return {};
}

/** Send the lead's draft by text or email. Returns { error } so the card shows the reason. */
export async function sendLeadOutreach(formData: FormData): Promise<{ error?: string }> {
  await requireOffice();
  const id = formData.get("id") as string;
  const draft_message = (formData.get("draft_message") as string) ?? "";
  if (!draft_message.trim()) return { error: "Write the message first." };

  const { data: lead, error: fetchError } = await supabase
    .from("leads")
    .select("*, customers(name, phone, email)")
    .eq("id", id)
    .single();

  if (fetchError || !lead) return { error: "Couldn't load this lead. Refresh and try again." };
  if (!lead.auto_sendable || lead.status !== "new") {
    return { error: "This lead can't be sent automatically (already handled, or not set up for it)." };
  }

  const customer = lead.customers as { name: string | null; phone: string | null; email: string | null } | null;

  if (lead.channel === "sms") {
    const to = lead.phone_number ?? customer?.phone;
    if (!to) return { error: "No phone number on file for this lead." };
    // A lead with no customer record needs an explicit opt-in on file.
    if (!(await canText(to))) {
      return {
        error:
          "Can't text this lead: no texting consent on file (or they opted out). Email them instead.",
      };
    }
    const sent = await sendSMS(to, draft_message);
    if (!sent.ok) return { error: `The text didn't go out (${sent.error ?? "unknown error"}).` };
  } else if (lead.channel === "email") {
    if (!customer?.email) return { error: "No email on file for this lead." };
    const { error: sendError } = await resend.emails.send({
      from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
      replyTo: RESEND_REPLY_TO,
      to: customer.email,
      subject: "A note from East Coast Mechanical",
      text: draft_message,
    });
    if (sendError) return { error: `The email didn't go out (${sendError.message}).` };
  } else {
    return { error: `Leads from "${lead.channel}" can't be sent from here. Copy the draft instead.` };
  }

  const { error: updateError } = await supabase
    .from("leads")
    .update({ status: "sent", sent_at: new Date().toISOString(), draft_message })
    .eq("id", id);
  if (updateError) return { error: "The message went out, but the lead didn't save as sent. Don't resend; refresh the page." };

  await syncLeadToGraph(id);

  revalidatePath("/leads");
  return {};
}
