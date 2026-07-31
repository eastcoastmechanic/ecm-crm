"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { sendSMS } from "@/lib/sms";
import { resend, RESEND_FROM_EMAIL } from "@/lib/resend";

export async function updateLeadDraft(formData: FormData) {
  const id = formData.get("id") as string;
  const draft_message = (formData.get("draft_message") as string) ?? "";

  const { error } = await supabase.from("leads").update({ draft_message }).eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/leads");
}

export async function markContacted(formData: FormData) {
  const id = formData.get("id") as string;

  const { error } = await supabase
    .from("leads")
    .update({ status: "contacted", contacted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/leads");
}

export async function dismissLead(formData: FormData) {
  const id = formData.get("id") as string;

  const { error } = await supabase
    .from("leads")
    .update({ status: "dismissed", dismissed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/leads");
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

  revalidatePath("/leads");
}
