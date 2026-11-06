"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { getMyStaffId, requireJobAccess } from "@/lib/job-access";
import { requireOwner, requireRole } from "@/lib/require-role";
import { getFinishBlockers } from "@/lib/job-checklist";
import { truckSetStatus } from "./actions";

type Result = { error?: string };

/** Tick or untick one checklist item on a job the person may work. */
export async function toggleChecklistItem(formData: FormData): Promise<void> {
  const itemId = String(formData.get("item_id") ?? "").trim();
  const done = String(formData.get("done") ?? "") === "true";
  if (!itemId) return;
  const { data: item } = await supabase.from("job_checklist_items").select("job_id").eq("id", itemId).maybeSingle();
  if (!item) return;
  await requireJobAccess(item.job_id as string);
  const staffId = await getMyStaffId();
  await supabase
    .from("job_checklist_items")
    .update(done ? { done_at: new Date().toISOString(), done_by: staffId } : { done_at: null, done_by: null })
    .eq("id", itemId);
  revalidatePath("/field-board");
}

/** Finish with the gate: a tech sees what is missing instead of the job closing. */
export async function finishJobAction(_prev: Result | null, formData: FormData): Promise<Result> {
  const role = await requireRole(["owner", "office", "tech"]);
  const jobId = String(formData.get("id") ?? "").trim();
  if (!jobId) return { error: "Missing job." };
  if (role === "tech") {
    const blockers = await getFinishBlockers(jobId);
    if (blockers.length > 0) return { error: blockers.join(" ") };
  }
  formData.set("status", "complete");
  return truckSetStatus(formData);
}

/** Owner only: let a stuck job be finished, with who and why on record. */
export async function unlockChecklist(formData: FormData): Promise<Result> {
  const role = await requireOwner();
  const jobId = String(formData.get("job_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!jobId) return { error: "Missing job." };
  if (reason.length < 5) return { error: "Say why, in a few words." };
  const { error } = await supabase.from("job_checklist_unlocks").insert({
    job_id: jobId,
    unlocked_by: await getMyStaffId(),
    unlocked_by_role: role,
    reason,
  });
  if (error) return { error: "Could not unlock. Try again." };
  revalidatePath("/field-board");
  return {};
}
