import { supabase } from "@/lib/supabase";
import { signStoredPhotos } from "@/lib/photo-urls";
import { copyFor, recordJobFiles, scheduleJobFileSync } from "@/lib/job-file-copies";
import { deleteFromJobsDrive } from "@/lib/job-folders";
import { cleanNamePart, fileExtension } from "@/lib/job-file-rules";

/**
 * Receipts on a job: a photo or PDF of what was bought, with vendor, amount paid, date and a short
 * note. Files sit in the private job-receipts bucket (SQL 0083) and are read through signed links.
 * Amounts are office-only: listReceiptsForOffice is the only read that returns them, and only
 * office/owner actions call it. Each receipt file is also copied to the job's SharePoint folder.
 */

export const JOB_RECEIPT_BUCKET = "job-receipts";

export const RECEIPTS_MIGRATION_MESSAGE = "Run db/migrations/0083_job_receipts_and_file_copies.sql in Supabase to turn on receipts.";

export type ReceiptRow = {
  id: string;
  job_id: string;
  vendor: string;
  amount_cents: number | null;
  purchased_on: string | null;
  note: string | null;
  file_path: string;
  file_name: string | null;
  content_type: string | null;
  uploaded_by_name: string | null;
  created_at: string;
};

/** Office view of a receipt: the row plus a short-lived link to the file. */
export type OfficeReceipt = ReceiptRow & { url: string | null };

export function isMissingReceiptsTable(message: string | null | undefined): boolean {
  return /job_receipts|job-receipts|bucket not found/i.test(message ?? "");
}

export async function saveJobReceipt(input: {
  jobId: string;
  file: File | Blob;
  vendor: string;
  amountCents: number | null;
  purchasedOn: string;
  note: string | null;
  staffId: string | null;
  staffName: string | null;
}): Promise<{ id: string } | { error: string }> {
  const name = input.file instanceof File && input.file.name ? input.file.name : "receipt";
  const contentType = input.file.type || "image/jpeg";
  const ext = fileExtension(name, contentType);
  const path = `${input.jobId}/${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage.from(JOB_RECEIPT_BUCKET).upload(path, input.file, { contentType });
  if (uploadError) {
    return { error: isMissingReceiptsTable(uploadError.message) ? RECEIPTS_MIGRATION_MESSAGE : "Couldn't save the receipt file. Try again." };
  }

  const { data, error } = await supabase
    .from("job_receipts")
    .insert({
      job_id: input.jobId,
      vendor: input.vendor,
      amount_cents: input.amountCents,
      purchased_on: input.purchasedOn,
      note: input.note,
      file_path: path,
      file_name: cleanNamePart(name, 120) || null,
      content_type: contentType,
      uploaded_by_staff_id: input.staffId,
      uploaded_by_name: input.staffName,
    })
    .select("id")
    .single();
  if (error || !data) {
    // Don't leave an orphan file behind.
    await supabase.storage.from(JOB_RECEIPT_BUCKET).remove([path]);
    return { error: isMissingReceiptsTable(error?.message) ? RECEIPTS_MIGRATION_MESSAGE : "Couldn't save the receipt. Try again." };
  }

  await recordJobFiles(input.jobId, [
    { kind: "receipt", bucket: JOB_RECEIPT_BUCKET, path, label: input.vendor, receiptId: data.id as string },
  ]);
  scheduleJobFileSync(input.jobId);
  return { id: data.id as string };
}

/** Office/owner only (callers check the role): every receipt on the job, with amounts and links. */
export async function listReceiptsForOffice(jobId: string): Promise<{ receipts: OfficeReceipt[]; error?: string }> {
  const { data, error } = await supabase
    .from("job_receipts")
    .select("id, job_id, vendor, amount_cents, purchased_on, note, file_path, file_name, content_type, uploaded_by_name, created_at")
    .eq("job_id", jobId)
    .order("created_at", { ascending: true });
  if (error) return { receipts: [], error: isMissingReceiptsTable(error.message) ? RECEIPTS_MIGRATION_MESSAGE : "Couldn't load receipts." };
  const rows = (data ?? []) as ReceiptRow[];
  const signed = await signStoredPhotos(
    rows.map((r) => ({ path: r.file_path, url: null as string | null, id: r.id })),
    { defaultBucket: JOB_RECEIPT_BUCKET }
  );
  const urlById = new Map(signed.map((s) => [s.id as string, s.url ?? null]));
  return { receipts: rows.map((r) => ({ ...r, url: urlById.get(r.id) ?? null })) };
}

/** How many receipts a job has. The only receipt fact a tech's screen gets. */
export async function countReceipts(jobId: string): Promise<number | null> {
  const { count, error } = await supabase.from("job_receipts").select("id", { count: "exact", head: true }).eq("job_id", jobId);
  return error ? null : (count ?? 0);
}

/** Office: delete a receipt, its stored file and its SharePoint copy. */
export async function deleteJobReceipt(receiptId: string): Promise<{ jobId: string } | { error: string }> {
  const { data: row, error } = await supabase.from("job_receipts").select("id, job_id, file_path").eq("id", receiptId).maybeSingle();
  if (error) return { error: isMissingReceiptsTable(error.message) ? RECEIPTS_MIGRATION_MESSAGE : "Couldn't find the receipt." };
  if (!row) return { error: "That receipt is already gone." };

  const copy = await copyFor(JOB_RECEIPT_BUCKET, row.file_path as string).catch(() => null);
  const { error: delError } = await supabase.from("job_receipts").delete().eq("id", receiptId);
  if (delError) return { error: "Couldn't delete the receipt. Try again." };

  await supabase.storage.from(JOB_RECEIPT_BUCKET).remove([row.file_path as string]);
  if (copy) await deleteFromJobsDrive(copy.sharepoint_item_id);
  return { jobId: row.job_id as string };
}
