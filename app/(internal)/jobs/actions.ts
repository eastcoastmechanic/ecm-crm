"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { sendOnWayNotice } from "@/lib/on-way-notice";
import {
  appendJobPhotos,
  uploadJobPhotoFiles,
  JOB_PHOTO_PHASES,
  type JobPhotoPhase,
} from "@/lib/job-photos";
import { syncJobToGraph } from "@/lib/graph-connector";
import { noteJobStep, syncJobToPlanner } from "@/lib/planner-connector";
import { applyJobStatus } from "@/lib/job-lifecycle";
import { requireOffice, requireRole } from "@/lib/require-role";
import { notifyTech } from "@/lib/tech-notice-send";
import { getMyStaffId, requireJobAccess } from "@/lib/job-access";
import { getFinishBlockers } from "@/lib/job-checklist";
import { getInvoicePrompt } from "@/lib/finish-invoice";
import type { InvoicePrompt } from "@/lib/job-invoice-rules";
import { moveToEtDate, parseEtLocal } from "@/lib/tz";
import { afterTimeSet, moveJobToTime, timeMoved } from "@/lib/job-reschedule";

/** Start a service call and open its report. Problems come back inline instead of an error page. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- useActionState passes the previous state first
export async function createServiceCall(_prev: { error?: string } | null): Promise<{ error?: string }> {
  const role = await requireRole(["owner", "office", "tech"]);
  // A tech who starts a service call owns it, so the ownership checks let them finish it.
  const assigned_staff_id = role === "tech" ? await getMyStaffId() : null;
  if (role === "tech" && !assigned_staff_id) return { error: "Your login isn't linked to a staff record. Ask the office." };

  const { data: job, error } = await supabase
    .from("jobs")
    .insert({
      ...(assigned_staff_id ? { assigned_staff_id } : {}),
      customer_id: null,
      property_id: null,
      status: "in_progress",
      job_type: "service",
      scheduled_at: new Date().toISOString(),
      created_via: "manual",
    })
    .select("id")
    .single();

  if (error || !job) return { error: "Couldn't start the service call. Try again." };

  await syncJobToPlanner(job.id, "in_progress", { note: true });

  revalidatePath("/jobs");
  redirect(`/diagnostics/new?job_id=${job.id}`);
}

/** Create the install job for a signed contract. One job per contract; a repeat just opens the existing one. */
/** `scheduledAt` echoes what was typed so the form can keep it after an error (React clears uncontrolled fields). */
export type ScheduleJobState = { error: string; scheduledAt: string } | null;

export async function scheduleJobFromContract(_prev: ScheduleJobState, formData: FormData): Promise<ScheduleJobState> {
  await requireOffice();
  const documentId = formData.get("document_id") as string;
  const typedAt = String(formData.get("scheduled_at") ?? "");
  const when = parseEtLocal(typedAt);
  if (!when) return { error: "Pick a date and time for the job.", scheduledAt: typedAt };

  const { data: doc, error: docError } = await supabase
    .from("documents")
    .select("id, type, status, customer_id, property_id, line_items")
    .eq("id", documentId)
    .single();
  if (docError || !doc) return { error: "Contract not found.", scheduledAt: typedAt };
  if (doc.type !== "contract" || doc.status !== "signed") return { error: "Only a signed contract can be scheduled.", scheduledAt: typedAt };

  const { data: existing } = await supabase.from("jobs").select("id").eq("document_id", documentId).limit(1);
  if (existing && existing.length > 0) redirect("/jobs");

  const scope = ((doc.line_items as { scopeOfWork?: string } | null)?.scopeOfWork ?? "").trim();
  const { data: job, error } = await supabase
    .from("jobs")
    .insert({
      customer_id: doc.customer_id,
      property_id: doc.property_id,
      document_id: doc.id,
      job_type: "install",
      status: "scheduled",
      scheduled_at: when.toISOString(),
      notes: scope ? scope.slice(0, 500) : null,
      created_via: "manual",
    })
    .select("id")
    .single();
  if (error || !job) return { error: error?.message ?? "Couldn't schedule the job. Try again.", scheduledAt: typedAt };

  await syncJobToPlanner(job.id, "scheduled", { note: true });
  await syncJobToGraph(job.id);

  revalidatePath("/jobs");
  revalidatePath(`/documents/${documentId}`);
  redirect("/jobs");
}

/** `staffId` echoes the pick so the select keeps it after an error (React resets uncontrolled fields). */
export type AssignJobState = { error: string; staffId: string } | null;

/** Assign from the jobs list. Problems come back inline instead of an error page. */
export async function assignJob(_prev: AssignJobState, formData: FormData): Promise<AssignJobState> {
  const jobId = String(formData.get("job_id") ?? "");
  const picked = String(formData.get("staff_id") ?? "").trim();
  const result = await assignJobToStaff(jobId, picked || null);
  return result.error ? { error: result.error, staffId: picked } : null;
}

/** Assign a job to a staff member, or clear it (null). Shared by the jobs list and dispatch. */
export async function assignJobToStaff(jobId: string, staffId: string | null): Promise<{ error?: string }> {
  await requireOffice();
  if (!jobId) return { error: "Job is required." };

  const { data: before, error: readError } = await supabase
    .from("jobs")
    .select("assigned_staff_id")
    .eq("id", jobId)
    .maybeSingle();
  if (readError) return { error: "Couldn't load the job. Try again." };
  if (!before) return { error: "Job not found." };
  const previousStaffId = (before.assigned_staff_id as string | null | undefined) ?? null;

  if (staffId) {
    const { data: staffRow } = await supabase.from("staff").select("id").eq("id", staffId).maybeSingle();
    if (!staffRow) return { error: "That staff member no longer exists. Refresh and pick again." };
  }

  const { error } = await supabase.from("jobs").update({ assigned_staff_id: staffId }).eq("id", jobId);
  if (error) return { error: "Couldn't save the assignment. Try again." };

  // Tell the tech who got the job, and the one who lost it. Best effort, never blocks.
  if (staffId !== previousStaffId) {
    const actorStaffId = await getMyStaffId();
    await notifyTech({ jobId, staffId, kind: "assigned", actorStaffId });
    await notifyTech({ jobId, staffId: previousStaffId, kind: "unassigned", actorStaffId });
  }

  revalidatePath("/jobs");
  revalidatePath("/field-board");
  return {};
}

/**
 * Change a job's status through job-lifecycle. Returns { error } instead of
 * throwing: production builds hide a thrown server action's message, so the
 * Jobs list and the Field Board could only show a generic failure.
 */
export async function updateJobStatus(formData: FormData): Promise<{ error?: string; invoicePrompt?: InvoicePrompt }> {
  const id = String(formData.get("id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  if (!id) return { error: "Job is required." };
  if (!status) return { error: "Pick a status." };

  // Office and owner can set any status. A tech can only start or finish their own open job.
  let role: Awaited<ReturnType<typeof requireJobAccess>>;
  try {
    role = await requireJobAccess(id, { nextStatus: status });
  } catch (err) {
    return { error: err instanceof Error && err.message !== "Not allowed" ? err.message : "You can't change this job." };
  }

  // A tech cannot finish a job with an open checklist or no photo (the owner can unlock it).
  if (role === "tech" && status === "complete") {
    const blockers = await getFinishBlockers(id);
    if (blockers.length > 0) return { error: blockers.join(" ") };
  }

  try {
    await applyJobStatus(id, status);
  } catch {
    return { error: "Couldn't save the status. Try again." };
  }

  revalidatePath("/jobs");
  // Owner/office finishing a job get the invoice to send (made as a draft in applyJobStatus).
  // A tech gets nothing back: no invoice, no amount.
  if (status === "complete" && role !== "tech") {
    const invoicePrompt = await getInvoicePrompt(id);
    if (invoicePrompt) return { invoicePrompt };
  }
  return {};
}

/** Change a job's date and time (New York wall-clock, "2026-10-22T09:30"). Notifies the customer and syncs Graph. */
// Reschedule actions return { error } instead of throwing: production builds hide a
// thrown server action's message, so the caller could only show a generic failure.

/** Move a job to a New York date and time ("2026-10-22T09:30"). Used by dispatch. */
export async function rescheduleJobAt(jobId: string, localDateTime: string): Promise<{ error?: string }> {
  await requireOffice();
  const after = await moveJobToTime(jobId, localDateTime);
  revalidatePath("/jobs");
  revalidatePath("/dispatch");
  return after;
}

/**
 * Move a job to another New York day ("YYYY-MM-DD"), keeping its New York time
 * (9:00 AM if it had none). Used by the jobs list date box and drag-and-drop.
 */
export async function rescheduleJob(jobId: string, newDate: string): Promise<{ error?: string }> {
  await requireOffice();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return { error: "Pick a valid date." };

  const { data: existing, error: fetchError } = await supabase
    .from("jobs")
    .select("scheduled_at, status")
    .eq("id", jobId)
    .maybeSingle();
  if (fetchError) return { error: "Couldn't load the job. Try again." };
  if (!existing) return { error: "Job not found." };

  const next = moveToEtDate((existing.scheduled_at as string | null) ?? null, newDate);
  if (!next) return { error: "Pick a valid date." };

  const { error } = await supabase
    .from("jobs")
    .update({ scheduled_at: next.toISOString() })
    .eq("id", jobId);
  if (error) return { error: "Couldn't save the new date. Try again." };

  const after = await afterTimeSet(jobId, (existing.status as string | null) ?? null, timeMoved(existing.scheduled_at, next));

  revalidatePath("/jobs");
  revalidatePath("/dispatch");
  return after;
}

export async function addJobPhotos(formData: FormData) {
  const jobId = formData.get("job_id") as string;
  await requireJobAccess(jobId, { allowClosedJob: true });
  const caption = (formData.get("caption") as string)?.trim() || null;
  const files = formData.getAll("photos") as File[];

  const rawPhase = formData.get("phase") as string | null;
  const phase = JOB_PHOTO_PHASES.includes(rawPhase as JobPhotoPhase)
    ? (rawPhase as JobPhotoPhase)
    : undefined;

  // Uploads go to the private job-photos bucket; the page mints signed URLs to
  // display them. See lib/job-photos.ts.
  const newPhotos = await uploadJobPhotoFiles(files, { phase, caption });
  if (newPhotos.length === 0) return;

  await appendJobPhotos(jobId, newPhotos);

  revalidatePath("/jobs");
}

export async function markOnWay(jobId: string) {
  await requireJobAccess(jobId);
  const { data: before } = await supabase.from("jobs").select("on_way_at").eq("id", jobId).maybeSingle();
  const { error } = await supabase
    .from("jobs")
    .update({ on_way_at: new Date().toISOString() })
    .eq("id", jobId);
  if (error) throw new Error(error.message);

  await sendOnWayNotice(jobId);
  // First On my way only: a second tap does not log the step again.
  if (!before?.on_way_at) await noteJobStep(jobId, "on_way");

  revalidatePath("/jobs");
}
