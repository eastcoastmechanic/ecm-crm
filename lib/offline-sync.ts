import { after } from "next/server";
import { supabase } from "@/lib/supabase";
import { applyJobStatus } from "@/lib/job-lifecycle";
import { checkJobAccess, getMyStaffId } from "@/lib/job-access";
import { getFinishBlockers } from "@/lib/job-checklist";
import { startJobEntry } from "@/lib/time-clock";
import { sendOnWayNotice } from "@/lib/on-way-notice";
import { syncJobNotesToOneNote } from "@/lib/onenote-sync";
import {
  clampTapTime,
  isMissingClientActionColumn,
  isUniqueViolation,
  shouldSendOnWayNotice,
  type SyncRequest,
} from "@/lib/offline-sync-rules";

// Applies one truck-screen tap that went through the phone's queue (/field-board/sync).
// Every tap goes this way, with signal or without, so there is one path to keep right.
//
// Safe to send twice (the phone retries until it hears back):
//   - On my way only stamps a job with no on_way_at yet (conditional update).
//   - I'm here and Finish go through applyJobStatus, which only changes a job still in the
//     status it read; a job already there is "already done".
//   - Notes carry client_action_id, unique in job_notes (SQL 0076). Before 0076 runs, a note
//     with the same job, text and time is treated as the same note.
//
// The same rules as the buttons always had still apply: a tech only works their own or an
// unassigned job, and a tech's Finish is refused while the checklist or photo is missing.

export type SyncResult =
  | { ok: true; already?: boolean }
  /** retry: something on our side failed (database down); the phone keeps it and tries later. */
  | { ok: false; error: string; retry?: boolean };

const CLOSED = ["complete", "completed", "cancelled", "canceled"];
const RETRY: SyncResult = { ok: false, error: "Couldn't save right now. Will try again.", retry: true };
/** A tap older than this when it lands moves the time-clock entry back to the tap. */
const BACKDATE_AFTER_MS = 60_000;

export async function applyOfflineAction(req: SyncRequest, now: Date = new Date()): Promise<SyncResult> {
  const access = await checkJobAccess(req.jobId, { allowClosedJob: true });
  if (access.error !== undefined) return { ok: false, error: access.error };

  const { data: job, error } = await supabase
    .from("jobs")
    .select("status, on_way_at, arrived_at, completed_at")
    .eq("id", req.jobId)
    .maybeSingle();
  if (error) return RETRY;
  if (!job) return { ok: false, error: "Job not found." };

  const status = (job.status as string | null) ?? null;
  const closed = status !== null && CLOSED.includes(status);

  try {
    switch (req.type) {
      case "note":
        return await saveNote(req, now);
      case "on_way":
        if (closed || status === "in_progress" || job.on_way_at) return { ok: true, already: true };
        return await onMyWay(req, now);
      case "arrive":
        if (closed || status === "in_progress") return { ok: true, already: true };
        return await arrive(req, now, (job.on_way_at as string | null) ?? null);
      case "finish":
        if (status === "complete" || status === "completed") return { ok: true, already: true };
        if (closed) return { ok: false, error: "This job was cancelled." };
        return await finish(req, now, (job.arrived_at as string | null) ?? (job.on_way_at as string | null) ?? null);
    }
  } catch (err) {
    console.error(`[offline-sync] ${req.type} on job ${req.jobId} failed:`, err instanceof Error ? err.message : err);
    return RETRY;
  }
}

async function onMyWay(req: SyncRequest, now: Date): Promise<SyncResult> {
  const at = clampTapTime(req.createdAt, now);
  const { data: claimed, error } = await supabase
    .from("jobs")
    .update({ on_way_at: at })
    .eq("id", req.jobId)
    .is("on_way_at", null)
    .select("id");
  if (error) return RETRY;
  if (!claimed || claimed.length === 0) return { ok: true, already: true };

  // A "your tech is on the way" that lands an hour late is worse than none.
  // Judged on the phone's own tap time: a tap too old to use as on_way_at is clamped to now,
  // but it is still far too late to tell the customer.
  if (shouldSendOnWayNotice(req.createdAt, now)) {
    try {
      await sendOnWayNotice(req.jobId);
    } catch (err) {
      console.error(`[offline-sync] on-the-way notice for job ${req.jobId} failed:`, err instanceof Error ? err.message : err);
    }
  }
  await startTimer(req.jobId, "drive", at, now);
  return { ok: true };
}

async function arrive(req: SyncRequest, now: Date, onWayAt: string | null): Promise<SyncResult> {
  const at = clampTapTime(req.createdAt, now, onWayAt);
  const { changed } = await applyJobStatus(req.jobId, "in_progress", { at });
  if (!changed) return { ok: true, already: true };
  await startTimer(req.jobId, "work", at, now);
  return { ok: true };
}

async function finish(req: SyncRequest, now: Date, startedAt: string | null): Promise<SyncResult> {
  // Same gate as the Finish button: a tech can't close a job with the checklist or photo
  // missing. The phone keeps the Finish and shows why, so the tech can fix it and retry.
  const access = await checkJobAccess(req.jobId, { nextStatus: "complete" });
  if (access.error !== undefined) return { ok: false, error: access.error };
  if (access.role === "tech") {
    const blockers = await getFinishBlockers(req.jobId);
    if (blockers.length > 0) return { ok: false, error: blockers.join(" ") };
  }
  const at = clampTapTime(req.createdAt, now, startedAt);
  const { changed } = await applyJobStatus(req.jobId, "complete", { at });
  return changed ? { ok: true } : { ok: true, already: true };
}

/**
 * Start the drive or work timer like the buttons always did. When the tap was made a while
 * ago (no signal), the entry just opened starts at the tap instead, and for I'm here the drive
 * leg it closed ends at the tap. Skipped for a login with no staff row.
 */
async function startTimer(jobId: string, kind: "drive" | "work", at: string, now: Date) {
  const staffId = await getMyStaffId();
  if (!staffId) return;
  const syncStartedAt = now.toISOString();
  await startJobEntry(jobId, staffId, kind);
  if (now.getTime() - Date.parse(at) < BACKDATE_AFTER_MS) return;

  const { error } = await supabase
    .from("job_time_entries")
    .update({ started_at: at })
    .eq("staff_id", staffId)
    .eq("job_id", jobId)
    .eq("kind", kind)
    .is("ended_at", null)
    .gte("started_at", syncStartedAt);
  if (error) console.error(`[offline-sync] could not move ${kind} start back for job ${jobId}: ${error.message}`);

  // Whatever timer that start closed (the drive leg on this job, or a timer still running on
  // the previous job) ends at the tap too, so the gap isn't counted twice.
  const { error: closeError } = await supabase
    .from("job_time_entries")
    .update({ ended_at: at })
    .eq("staff_id", staffId)
    .gte("ended_at", syncStartedAt)
    .lte("started_at", at);
  if (closeError) console.error(`[offline-sync] could not end the earlier timer at the tap for job ${jobId}: ${closeError.message}`);
}

const NOTE_MIGRATION_MESSAGE = "Run db/migrations/0065_job_notebook.sql in Supabase to turn on the notebook.";

async function saveNote(req: SyncRequest, now: Date): Promise<SyncResult> {
  const body = req.body ?? "";
  const at = clampTapTime(req.createdAt, now);
  const staffId = await getMyStaffId();
  let authorName: string | null = null;
  if (staffId) {
    const { data: staff } = await supabase.from("staff").select("name").eq("id", staffId).maybeSingle();
    authorName = (staff?.name as string | null) ?? null;
  }
  const row = { job_id: req.jobId, author_staff_id: staffId, author_name: authorName ?? "Office", body, created_at: at };

  let { error } = await supabase.from("job_notes").insert({ ...row, client_action_id: req.clientActionId });
  if (isUniqueViolation(error)) return { ok: true, already: true };

  if (error && isMissingClientActionColumn(error)) {
    // Before SQL 0076: same job, same words, same time means this note already landed.
    const { data: existing, error: findError } = await supabase
      .from("job_notes")
      .select("id")
      .eq("job_id", req.jobId)
      .eq("body", body)
      .eq("created_at", at)
      .limit(1);
    if (findError) return RETRY;
    if (existing && existing.length > 0) return { ok: true, already: true };
    ({ error } = await supabase.from("job_notes").insert(row));
  }

  if (error) {
    if (/job_notes/i.test(error.message ?? "")) return { ok: false, error: NOTE_MIGRATION_MESSAGE };
    return RETRY;
  }
  after(() => syncJobNotesToOneNote(req.jobId));
  return { ok: true };
}
