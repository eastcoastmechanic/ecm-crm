"use server";

import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { notifyOwnerOfVisitRequest } from "@/lib/notify-owner";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type VisitRequestState = { error?: string };

// Public: the private link is the only credential. It records one request per visit and
// alerts the owner. It never changes the job or the schedule.
export async function requestVisit(_prev: VisitRequestState, formData: FormData): Promise<VisitRequestState> {
  const token = String(formData.get("token") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!UUID.test(token)) return { error: "This link isn't valid. Please call us." };
  if (note.length > 500) return { error: "Please keep your note under 500 characters." };

  const { data: updated, error } = await supabase
    .from("maintenance_visits")
    .update({ customer_request_at: new Date().toISOString(), customer_request_note: note || null })
    .eq("confirm_token", token)
    .eq("status", "due")
    .is("customer_request_at", null)
    .select("id");
  if (error) return { error: "Something went wrong. Please call us and we'll book it with you." };

  // Only the first tap alerts Josh; a repeat tap just shows the thank-you page.
  if (updated && updated.length > 0) await notifyOwnerOfVisitRequest(updated[0].id as string);

  redirect(`/visit/${token}`);
}
