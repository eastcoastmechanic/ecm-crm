"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { sendSMS } from "@/lib/sms";
import { resend, RESEND_FROM_EMAIL } from "@/lib/resend";
import { syncLeadToGraph, deleteLeadFromGraph } from "@/lib/graph-connector";
import { createPlannerTask } from "@/lib/planner-connector";

export async function updateLeadDraft(formData: FormData) {
  const id = formData.get("id") as string;
  const draft_message = (formData.get("draft_message") as string) ?? "";

  const { error } = await supabase.from("leads").update({ draft_message }).eq("id", id);
  if (error) throw new Error(error.message);

  await syncLeadToGraph(id);

  revalidatePath("/leads");
}

export async function markContacted(formData: FormData) {
  const id = formData.get("id") as string;

  const { error } = await supabase
    .from("leads")
    .update({ status: "contacted", contacted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);

  await syncLeadToGraph(id);

  revalidatePath("/leads");
}

export async function dismissLead(formData: FormData) {
  const id = formData.get("id") as string;

  const { error } = await supabase
    .from("leads")
    .update({ status: "dismissed", dismissed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);

  await syncLeadToGraph(id);

  revalidatePath("/leads");
}

export async function addManualLead(formData: FormData) {
  const contact_name = (formData.get("contact_name") as string)?.trim();
  const phone_number = (formData.get("phone_number") as string)?.trim() || null;
  const email = (formData.get("email") as string)?.trim() || null;
  const town = (formData.get("town") as string)?.trim() || null;
  const address = (formData.get("address") as string)?.trim() || null;
  const summary = (formData.get("summary") as string)?.trim() || null;
  const urgency_score = Number(formData.get("urgency_score")) || 5;

  if (!contact_name) throw new Error("Name is required");

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
  if (error) throw new Error(error.message);

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
}

export async function setLeadStage(formData: FormData) {
  const id = formData.get("id") as string;
  const status = formData.get("status") as string;

  const update: Record<string, unknown> = { status };
  if (status === "contacted") update.contacted_at = new Date().toISOString();
  if (status === "lost") update.dismissed_at = new Date().toISOString();

  const { error } = await supabase.from("leads").update(update).eq("id", id);
  if (error) throw new Error(error.message);

  await syncLeadToGraph(id);

  revalidatePath("/leads");
}

export async function deleteLead(id: string): Promise<{ error?: string }> {
  const { error } = await supabase.from("leads").delete().eq("id", id);
  if (error) return { error: error.message };

  await deleteLeadFromGraph(id);

  revalidatePath("/leads");
  return {};
}

export async function sendLeadOutreach(formData: FormData) {
  const id = formData.get("id") as string;
  const draft_message = (formData.get("draft_message") as string) ?? "";

  const { data: lead, error: fetchError } = await supabase
    .from("leads")
    .select("*, customers(name, phone, email)")
    .eq("id", id)
    .single();

  if (fetchError || !lead) throw new Error(fetchError?.message ?? "Lead not found");
  if (!lead.auto_sendable || lead.status !== "new") {
    throw new Error("This lead is not eligible for automatic sending");
  }

  const customer = lead.customers as { name: string | null; phone: string | null; email: string | null } | null;

  if (lead.channel === "sms") {
    const to = lead.phone_number ?? customer?.phone;
    if (!to) throw new Error("No phone number on file for this lead");
    await sendSMS(to, draft_message);
  } else if (lead.channel === "email") {
    if (!customer?.email) throw new Error("No email on file for this lead");
    const { error: sendError } = await resend.emails.send({
      from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
      to: customer.email,
      subject: "A note from East Coast Mechanical",
      text: draft_message,
    });
    if (sendError) throw new Error(sendError.message);
  } else {
    throw new Error(`Channel "${lead.channel}" cannot be auto-sent`);
  }

  const { error: updateError } = await supabase
    .from("leads")
    .update({ status: "sent", sent_at: new Date().toISOString(), draft_message })
    .eq("id", id);
  if (updateError) throw new Error(updateError.message);

  await syncLeadToGraph(id);

  revalidatePath("/leads");
}
