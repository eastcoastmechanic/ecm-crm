import { after } from "next/server";
import { supabase } from "@/lib/supabase";
import { uploadToJobFolder } from "@/lib/job-folders";
import { syncJobLog } from "@/lib/job-log";
import {
  sharePointPathFor,
  shouldTryCopy,
  summarizeCopies,
  type CopyStatus,
  type CopySummary,
  type JobFileKind,
} from "@/lib/job-file-rules";

/**
 * Copies of job files (photos, receipts) in the property's SharePoint folder, the one the Teams
 * Job Notes Files tab shows. The CRM keeps the file (private bucket); SharePoint gets a copy so
 * everything that happened on a job is next to it in Teams.
 *
 * Each file gets a job_file_copies row when it is saved (SQL 0083), then a copy runs after the
 * response. A failure is written on the row and tried again the next time the job's files are
 * opened or another file is added. Nothing here throws, and nothing here can fail an upload.
 */

export type NewJobFile = {
  kind: JobFileKind;
  bucket: string;
  path: string;
  label?: string | null;
  receiptId?: string | null;
};

type CopyRow = {
  id: string;
  job_id: string;
  kind: JobFileKind;
  bucket: string;
  path: string;
  label: string | null;
  status: CopyStatus;
  attempts: number;
  created_at: string;
};

/** Note new files that should be copied. Before SQL 0083 this quietly does nothing. */
export async function recordJobFiles(jobId: string, files: NewJobFile[]): Promise<void> {
  if (files.length === 0) return;
  try {
    const { error } = await supabase.from("job_file_copies").upsert(
      files.map((f) => ({
        job_id: jobId,
        kind: f.kind,
        bucket: f.bucket,
        path: f.path,
        label: f.label ?? null,
        receipt_id: f.receiptId ?? null,
      })),
      { onConflict: "bucket,path", ignoreDuplicates: true }
    );
    if (error) console.error("[job-file-copies] record failed:", error.message);
  } catch (err) {
    console.error("[job-file-copies] record failed:", err instanceof Error ? err.message : "error");
  }
}

/** Copy one file. Returns the new status; the row is updated either way. */
async function copyOne(row: CopyRow): Promise<CopyStatus> {
  const attempts = row.attempts + 1;
  const { data: blob, error } = await supabase.storage.from(row.bucket).download(row.path);
  if (error || !blob) {
    await supabase
      .from("job_file_copies")
      .update({ status: "failed", attempts, last_error: "File is missing from CRM storage." })
      .eq("id", row.id);
    return "failed";
  }

  const relativePath = sharePointPathFor({
    kind: row.kind,
    jobId: row.job_id,
    storagePath: row.path,
    label: row.label,
    createdAt: row.created_at,
    contentType: blob.type,
  });
  const result = await uploadToJobFolder(row.job_id, relativePath, blob, blob.type || "application/octet-stream");

  if (result.ok) {
    await supabase
      .from("job_file_copies")
      .update({
        status: "copied",
        attempts,
        last_error: null,
        sharepoint_item_id: result.itemId,
        sharepoint_url: result.url,
        copied_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    return "copied";
  }

  // No property or no address: there is no folder to copy into. Not an error, and a later try
  // (after the office adds a property) picks it up, since "skipped" rows are retried too.
  const noFolder = result.reason === "no_property" || result.reason === "no_address";
  const status: CopyStatus = noFolder ? "skipped" : "failed";
  const why: Record<string, string> = {
    no_property: "The job has no property, so there is no folder.",
    no_address: "The property has no usable address for a folder.",
    not_configured: "SharePoint is not connected.",
    needs_migration: "Run SQL 0065 first.",
    graph_error: "Could not reach the SharePoint folder.",
  };
  await supabase
    .from("job_file_copies")
    .update({ status, attempts, last_error: result.reason === "upload_failed" ? (result.detail ?? "Upload failed.") : why[result.reason] })
    .eq("id", row.id);
  return status;
}

/**
 * Copy a job's files that are not in SharePoint yet. `force` (the office's Retry) also tries rows
 * that have used up their automatic attempts. Never throws.
 */
export async function syncJobFiles(jobId: string, opts: { force?: boolean; limit?: number } = {}): Promise<void> {
  try {
    const { data, error } = await supabase
      .from("job_file_copies")
      .select("id, job_id, kind, bucket, path, label, status, attempts, created_at")
      .eq("job_id", jobId)
      .neq("status", "copied")
      .order("created_at", { ascending: true })
      .limit(opts.limit ?? 25);
    if (error || !data) return;
    const rows = (data as CopyRow[]).filter((r) => opts.force || shouldTryCopy(r));
    // One at a time: the folder is made on the first, and SharePoint is not hammered.
    for (const row of rows) {
      try {
        await copyOne(row);
      } catch (err) {
        console.error("[job-file-copies] copy failed:", err instanceof Error ? err.message : "error");
      }
    }
  } catch (err) {
    console.error("[job-file-copies] sync failed:", err instanceof Error ? err.message : "error");
  }
}

/** Run the copy after the response so the upload never waits on Microsoft. */
export function scheduleJobFileSync(jobId: string): void {
  // Copy the files first, then rewrite the job log so it links to them.
  const run = async () => {
    await syncJobFiles(jobId);
    await syncJobLog(jobId);
  };
  try {
    after(run);
  } catch {
    // Outside a request (a script or test): just start it.
    void run();
  }
}

/** How the job's folder copies stand, for the office. Null before SQL 0083. */
export async function jobCopySummary(jobId: string): Promise<CopySummary | null> {
  const { data, error } = await supabase.from("job_file_copies").select("status").eq("job_id", jobId);
  if (error) return null;
  return summarizeCopies((data ?? []) as { status: CopyStatus }[]);
}

/** The SharePoint copy of one stored file, so a delete in the CRM can remove it too. */
export async function copyFor(bucket: string, path: string): Promise<{ id: string; sharepoint_item_id: string | null } | null> {
  const { data } = await supabase
    .from("job_file_copies")
    .select("id, sharepoint_item_id")
    .eq("bucket", bucket)
    .eq("path", path)
    .maybeSingle();
  return (data as { id: string; sharepoint_item_id: string | null } | null) ?? null;
}
