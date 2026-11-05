import { supabase } from "@/lib/supabase";
import { finishBlockers, isMissingTable, type ChecklistItem } from "@/lib/checklist-rules";

// Server side of the job checklist. Tables are in 0056_job_checklists.sql.
// If those tables are not there yet (SQL not run), every function here does nothing or
// returns "no gate", so deploying the code first never stops a tech from finishing a job.

type JobRef = { id: string; job_type: string | null };

/** Give each job that has no checklist yet a copy of its template (its own type, else 'default'). */
export async function ensureChecklists(jobs: JobRef[]): Promise<void> {
  if (jobs.length === 0) return;
  const ids = jobs.map((j) => j.id);

  const { data: existing, error: existingError } = await supabase
    .from("job_checklist_items")
    .select("job_id")
    .in("job_id", ids);
  if (existingError) return;
  const have = new Set((existing ?? []).map((r) => r.job_id as string));
  const missing = jobs.filter((j) => !have.has(j.id));
  if (missing.length === 0) return;

  const { data: templates } = await supabase
    .from("job_checklist_templates")
    .select("job_type, position, label, required")
    .order("position", { ascending: true });
  const rows = (templates ?? []) as { job_type: string; position: number; label: string; required: boolean }[];
  if (rows.length === 0) return;

  const inserts = missing.flatMap((job) => {
    const own = rows.filter((t) => t.job_type === (job.job_type ?? ""));
    const list = own.length > 0 ? own : rows.filter((t) => t.job_type === "default");
    return list.map((t) => ({ job_id: job.id, position: t.position, label: t.label, required: t.required }));
  });
  if (inserts.length === 0) return;
  // The (job_id, position) key makes a double load a no-op.
  await supabase.from("job_checklist_items").upsert(inserts, { onConflict: "job_id,position", ignoreDuplicates: true });
}

export async function loadChecklists(jobIds: string[]): Promise<Map<string, (ChecklistItem & { position: number })[]>> {
  const out = new Map<string, (ChecklistItem & { position: number })[]>();
  if (jobIds.length === 0) return out;
  const { data } = await supabase
    .from("job_checklist_items")
    .select("id, job_id, position, label, required, done_at")
    .in("job_id", jobIds)
    .order("position", { ascending: true });
  for (const r of (data ?? []) as { id: string; job_id: string; position: number; label: string; required: boolean; done_at: string | null }[]) {
    const list = out.get(r.job_id) ?? [];
    list.push({ id: r.id, position: r.position, label: r.label, required: r.required, done: Boolean(r.done_at) });
    out.set(r.job_id, list);
  }
  return out;
}

export async function unlockedJobIds(jobIds: string[]): Promise<Set<string>> {
  if (jobIds.length === 0) return new Set();
  const { data } = await supabase.from("job_checklist_unlocks").select("job_id").in("job_id", jobIds);
  return new Set((data ?? []).map((r) => r.job_id as string));
}

/**
 * Why a tech cannot finish this job yet (empty = they can). Fails open only when the checklist
 * tables are missing, so the gate applies once 0056 has been run. Other errors block.
 */
export async function getFinishBlockers(jobId: string): Promise<string[]> {
  const { data: items, error } = await supabase
    .from("job_checklist_items")
    .select("id, label, required, done_at")
    .eq("job_id", jobId);
  if (error) {
    // Only a missing table (SQL not run yet) skips the gate. Any other failure blocks, so a
    // timeout can never let an unfinished job through.
    if (isMissingTable(error)) {
      console.error(`[checklist] gate skipped, checklist tables not available: ${error.message}`);
      return [];
    }
    console.error(`[checklist] could not check the checklist: ${error.message}`);
    return ["Could not check the checklist right now. Try again."];
  }
  const [{ data: job }, unlocked] = await Promise.all([
    supabase.from("jobs").select("photos").eq("id", jobId).maybeSingle(),
    unlockedJobIds([jobId]),
  ]);
  const photoCount = Array.isArray(job?.photos) ? (job?.photos as unknown[]).length : 0;
  return finishBlockers({
    items: ((items ?? []) as { id: string; label: string; required: boolean; done_at: string | null }[]).map((i) => ({
      id: i.id,
      label: i.label,
      required: i.required,
      done: Boolean(i.done_at),
    })),
    photoCount,
    unlocked: unlocked.has(jobId),
  });
}
