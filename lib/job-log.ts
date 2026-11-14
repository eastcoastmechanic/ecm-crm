import { after } from "next/server";
import { supabase } from "@/lib/supabase";
import { one } from "@/lib/appointment-reminder";
import { uploadToJobFolder } from "@/lib/job-folders";
import { buildJobLogText, jobLogFileName, type JobLogInput } from "@/lib/job-log-rules";

/**
 * A running job log in the property's SharePoint folder (Job Notes / "<street> <town>" /
 * "<date> <type> <id> - Job log.txt"), rebuilt from CRM data every time something happens on the
 * job: created, scheduled, rescheduled, assigned, on my way, on site, timers, done, notes, photos,
 * receipts, invoices. Always the whole file from scratch, so it is idempotent and a missed event
 * is fixed by the next one.
 *
 * Techs can open the folder, so nothing money goes in (see job-log-rules.ts).
 * Nothing here throws: a SharePoint problem never fails the job action that triggered it.
 */

const ID = /^[\w-]+$/;

type JobRow = JobLogInput["job"] & {
  property_id: string | null;
  document_id: string | null;
  assigned_staff_id: string | null;
  photos: unknown;
  customers: { name: string | null } | { name: string | null }[] | null;
  properties: { address: string | null } | { address: string | null }[] | null;
};

/** Read everything the log shows for one job. Null when the job is gone. */
async function loadJobLogInput(jobId: string): Promise<JobLogInput | null> {
  const { data: job } = await supabase
    .from("jobs")
    .select(
      "id, job_type, status, created_at, scheduled_at, on_way_at, arrived_at, completed_at, notes, created_via, property_id, document_id, assigned_staff_id, photos, customers(name), properties(address)"
    )
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return null;
  const row = job as unknown as JobRow;

  const invoiceOr = [`job_id.eq.${jobId}`, `balance_for_job_id.eq.${jobId}`];
  if (row.document_id && ID.test(row.document_id)) invoiceOr.push(`id.eq.${row.document_id}`);

  const [entriesRes, notesRes, copiesRes, receiptsRes, invoicesRes, linkedRes, reportsRes] = await Promise.all([
    // "*" so voided_at (SQL 0078) comes back once it exists.
    supabase.from("job_time_entries").select("*").eq("job_id", jobId).order("started_at"),
    supabase.from("job_notes").select("author_name, body, created_at").eq("job_id", jobId).order("created_at"),
    supabase.from("job_file_copies").select("path, sharepoint_url").eq("job_id", jobId),
    // No amount column: the log never carries money.
    supabase.from("job_receipts").select("vendor, purchased_on, note, uploaded_by_name, created_at, file_path").eq("job_id", jobId).order("created_at"),
    supabase.from("documents").select("doc_number, status, created_at, sent_at, paid_at").eq("type", "invoice").or(invoiceOr.join(",")).order("created_at"),
    row.document_id
      ? supabase.from("documents").select("doc_number, type, status").eq("id", row.document_id).neq("type", "invoice").maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("diagnostics").select("doc_number, created_at").eq("job_id", jobId).order("created_at"),
  ]);

  const entries = (entriesRes.data ?? []) as { staff_id: string; kind: string; started_at: string; ended_at: string | null; note: string | null; voided_at?: string | null }[];
  const staffIds = [...new Set([...entries.map((e) => e.staff_id), row.assigned_staff_id].filter((v): v is string => Boolean(v)))];
  const { data: staffRows } = staffIds.length
    ? await supabase.from("staff").select("id, name, email").in("id", staffIds)
    : { data: [] as { id: string; name: string | null; email: string | null }[] };
  const staffName = new Map((staffRows ?? []).map((s) => [s.id as string, ((s.name as string | null) || "Staff") as string]));

  const linkByPath = new Map(
    ((copiesRes.data ?? []) as { path: string; sharepoint_url: string | null }[]).map((c) => [c.path, c.sharepoint_url])
  );
  const photos = Array.isArray(row.photos)
    ? (row.photos as { path?: string; phase?: string | null; caption?: string | null; taken_at?: string | null }[]).map((p) => ({
        phase: p.phase ?? null,
        caption: p.caption ?? null,
        taken_at: p.taken_at ?? null,
        link: p.path ? (linkByPath.get(p.path) ?? null) : null,
      }))
    : [];

  return {
    job: row,
    customerName: one(row.customers)?.name ?? null,
    address: one(row.properties)?.address ?? null,
    assignedTech: row.assigned_staff_id ? (staffName.get(row.assigned_staff_id) ?? null) : null,
    linkedDoc: (linkedRes.data as JobLogInput["linkedDoc"]) ?? null,
    timeEntries: entries.map((e) => ({ ...e, staff: staffName.get(e.staff_id) ?? null })),
    notes: (notesRes.data ?? []) as JobLogInput["notes"],
    photos,
    // Before SQL 0083 the receipts table is missing: no receipts, not an error.
    receipts: ((receiptsRes.data ?? []) as (JobLogInput["receipts"][number] & { file_path: string })[]).map((r) => ({
      vendor: r.vendor,
      purchased_on: r.purchased_on,
      note: r.note,
      uploaded_by_name: r.uploaded_by_name,
      created_at: r.created_at,
      link: linkByPath.get(r.file_path) ?? null,
    })),
    invoices: (invoicesRes.data ?? []) as JobLogInput["invoices"],
    reports: (reportsRes.data ?? []) as JobLogInput["reports"],
    builtAt: new Date(),
  };
}

export type JobLogResult = { ok: true; url: string | null } | { ok: false; reason: string };

/** Rebuild one job's log file now. Never throws. */
export async function writeJobLog(jobId: string): Promise<JobLogResult> {
  try {
    const input = await loadJobLogInput(jobId);
    if (!input) return { ok: false, reason: "job not found" };
    // No property means no folder: nothing to write (and no folder is made for it).
    if (!(input.job as JobRow).property_id) return { ok: false, reason: "no_property" };

    const text = "﻿" + buildJobLogText(input); // BOM so Windows tools read it as UTF-8
    const result = await uploadToJobFolder(jobId, jobLogFileName(input.job), text, "text/plain; charset=utf-8");
    if (!result.ok) return { ok: false, reason: result.reason };

    // Before SQL 0084 these columns are missing; the log is still written.
    await supabase
      .from("jobs")
      .update({ log_synced_at: new Date().toISOString(), log_file_url: result.url, log_failed_at: null })
      .eq("id", jobId)
      .then(() => null, () => null);
    return { ok: true, url: result.url };
  } catch (err) {
    console.error("[job-log] write failed:", err instanceof Error ? err.message : "error");
    return { ok: false, reason: "error" };
  }
}

// One rebuild at a time per job on this server. Events that land while one runs ask for one more
// rebuild afterwards, so a burst (Finish: status, timers, invoice) writes the file twice at most.
const running = new Map<string, { again: boolean; done: Promise<void> }>();

export function syncJobLog(jobId: string): Promise<void> {
  if (!jobId || !ID.test(jobId)) return Promise.resolve();
  const current = running.get(jobId);
  if (current) {
    current.again = true;
    return current.done;
  }
  const state = { again: false, done: Promise.resolve() };
  state.done = (async () => {
    try {
      do {
        state.again = false;
        await writeJobLog(jobId);
      } while (state.again);
    } finally {
      running.delete(jobId);
    }
  })();
  running.set(jobId, state);
  return state.done;
}

/** Fire and forget: rebuild after the response, so no button waits on SharePoint. */
export function scheduleJobLogSync(jobId: string | null | undefined): void {
  if (!jobId) return;
  const run = () => syncJobLog(jobId);
  try {
    after(run);
  } catch {
    // Outside a request (or inside another after()): just start it.
    void run().catch(() => undefined);
  }
}

/**
 * Owner backfill: write the log for jobs whose address already has a folder, oldest-unwritten
 * first, a batch per press. Needs SQL 0084 (log_synced_at) to know which are done.
 */
export async function rebuildJobLogs(limit = 20): Promise<{ written: number; failed: number; remaining: number | null } | { error: string }> {
  const { data, error } = await supabase
    .from("jobs")
    .select("id, properties!inner(files_folder_url)")
    .not("properties.files_folder_url", "is", null)
    .is("log_synced_at", null)
    .is("log_failed_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    return { error: /log_synced_at/.test(error.message) ? "Run db/migrations/0084_job_log_file.sql in Supabase first." : "Couldn't list jobs." };
  }
  let written = 0;
  let failed = 0;
  for (const row of data ?? []) {
    const result = await writeJobLog(row.id as string);
    if (result.ok) written++;
    else {
      failed++;
      await supabase.from("jobs").update({ log_failed_at: new Date().toISOString() }).eq("id", row.id as string);
    }
  }
  const { count } = await supabase
    .from("jobs")
    .select("id, properties!inner(files_folder_url)", { count: "exact", head: true })
    .not("properties.files_folder_url", "is", null)
    .is("log_synced_at", null)
    .is("log_failed_at", null);
  return { written, failed, remaining: count ?? null };
}
