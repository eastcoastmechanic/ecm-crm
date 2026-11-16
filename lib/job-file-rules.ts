// Pure rules for job files (photos and receipts) and their copies in the SharePoint job folder.
// No database or Microsoft imports, so they can be tested on their own.

import { etDateKey } from "@/lib/tz";

export type JobFileKind = "photo" | "receipt";

/** Subfolder inside the property's folder (Job Notes / "<street> <town>" / ...). */
export const JOB_FILE_SUBFOLDER: Record<JobFileKind, string> = {
  photo: "Photos",
  receipt: "Receipts",
};

/** Give up retrying a copy after this many tries; the office can still press Retry. */
export const MAX_COPY_ATTEMPTS = 5;

/** Receipts: photo or PDF, and small enough for one request (Vercel caps a body at 4.5 MB). */
export const RECEIPT_MAX_BYTES = 4 * 1024 * 1024;
export const RECEIPT_TYPES = ["image/jpeg", "image/png", "image/heic", "image/heif", "image/webp", "application/pdf"];

/** The first 8 characters of a job id: enough to tell jobs at one address apart. */
export function jobShortId(jobId: string): string {
  return jobId.replace(/-/g, "").slice(0, 8);
}

/** Characters SharePoint refuses in a file name, plus control characters, become spaces. */
export function cleanNamePart(value: string | null | undefined, max = 40): string {
  if (!value) return "";
  return value
    .replace(/["*:<>?/\\|#%~&{}\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim()
    .replace(/[. ]+$/, "");
}

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

/** File extension from the stored name, else from the content type, else jpg. */
export function fileExtension(name: string | null | undefined, contentType?: string | null): string {
  const m = /\.([A-Za-z0-9]{2,5})$/.exec(name ?? "");
  if (m) return m[1].toLowerCase();
  return EXT_BY_TYPE[(contentType ?? "").toLowerCase()] ?? "jpg";
}

/**
 * File name in the SharePoint folder:
 *   Photos/2026-11-13 job 1a2b3c4d arrival 5f6e7a.jpg
 *   Receipts/2026-11-13 job 1a2b3c4d Home Depot 5f6e7a.pdf
 * New York date of the upload, the job's short id, the photo phase or receipt vendor, and a
 * piece of the stored file's own id so two files never land on one name (a retry rewrites the
 * same name, so it never makes a second copy). No money in names: techs can open this folder.
 */
export function sharePointPathFor(input: {
  kind: JobFileKind;
  jobId: string;
  storagePath: string;
  label?: string | null;
  createdAt?: string | Date | null;
  contentType?: string | null;
}): string {
  const when = input.createdAt ? new Date(input.createdAt) : new Date();
  const date = Number.isNaN(when.getTime()) ? etDateKey() : etDateKey(when);
  const base = input.storagePath.split("/").pop() ?? input.storagePath;
  const unique = cleanNamePart(base.replace(/-/g, "").slice(0, 6), 6) || "file";
  const label = cleanNamePart(input.label);
  const name = [date, "job", jobShortId(input.jobId), label, unique].filter(Boolean).join(" ");
  return `${JOB_FILE_SUBFOLDER[input.kind]}/${name}.${fileExtension(base, input.contentType)}`;
}

export type CopyStatus = "pending" | "copied" | "failed" | "skipped";

/** Whether an automatic sync should try this copy again. */
export function shouldTryCopy(row: { status: CopyStatus; attempts: number }): boolean {
  if (row.status === "copied") return false;
  if (row.status === "pending") return true;
  return row.attempts < MAX_COPY_ATTEMPTS;
}

export type CopySummary = { copied: number; waiting: number; failed: number; skipped: number };

export function summarizeCopies(rows: { status: CopyStatus }[]): CopySummary {
  const out: CopySummary = { copied: 0, waiting: 0, failed: 0, skipped: 0 };
  for (const r of rows) {
    if (r.status === "copied") out.copied++;
    else if (r.status === "failed") out.failed++;
    else if (r.status === "skipped") out.skipped++;
    else out.waiting++;
  }
  return out;
}

/** Plain line for the office: how the folder copies stand. Null when there is nothing to copy. */
export function copySummaryLine(s: CopySummary): string | null {
  const total = s.copied + s.waiting + s.failed + s.skipped;
  if (total === 0) return null;
  const parts = [`${s.copied} of ${total} files copied to the job folder`];
  if (s.waiting) parts.push(`${s.waiting} waiting`);
  if (s.failed) parts.push(`${s.failed} failed`);
  if (s.skipped) parts.push(`${s.skipped} skipped (no folder for this job)`);
  return parts.join(", ") + ".";
}

/** A receipt's date: a valid YYYY-MM-DD typed by the user, else today in New York. */
export function receiptDate(raw: string | null | undefined, now: Date = new Date()): string {
  const v = (raw ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const d = new Date(`${v}T12:00:00Z`);
    if (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v) return v;
  }
  return etDateKey(now);
}
