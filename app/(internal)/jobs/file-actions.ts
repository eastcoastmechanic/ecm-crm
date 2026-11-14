"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { requireOffice } from "@/lib/require-role";
import { checkJobAccess, getMyStaffId } from "@/lib/job-access";
import { parseMoneyToCents } from "@/lib/job-invoice-rules";
import { copySummaryLine, receiptDate, RECEIPT_MAX_BYTES, RECEIPT_TYPES } from "@/lib/job-file-rules";
import { jobCopySummary, syncJobFiles } from "@/lib/job-file-copies";
import { countReceipts, deleteJobReceipt, listReceiptsForOffice, saveJobReceipt, type OfficeReceipt } from "@/lib/job-receipts";
import { removeJobPhoto, resolveJobPhotos } from "@/lib/job-photos";

// Receipts and folder copies for one job. A tech may add a receipt to a job that is theirs, and
// gets back only a count: amounts, the receipt list and money never go to a tech's screen.
// Listing receipts, deleting, and Retry are office/owner only (checked inside each action).

export type OfficeFilesState = {
  error?: string;
  receipts: OfficeReceipt[];
  /** Photos stored in the private bucket (the ones that can be deleted here), with signed links. */
  photos: { path: string; url: string | null; phase: string | null }[];
  /** "3 of 4 files copied to the job folder, 1 failed." Null when nothing to copy. */
  copyLine: string | null;
  canRetry: boolean;
};

export async function loadOfficeJobFiles(jobId: string): Promise<OfficeFilesState> {
  try {
    await requireOffice();
  } catch {
    return { error: "Not allowed", receipts: [], photos: [], copyLine: null, canRetry: false };
  }
  const [{ receipts, error }, summary, jobRes] = await Promise.all([
    listReceiptsForOffice(jobId),
    jobCopySummary(jobId),
    supabase.from("jobs").select("photos").eq("id", jobId).maybeSingle(),
  ]);
  const signed = await resolveJobPhotos(jobRes.data?.photos);
  const photos = signed
    .filter((p) => p.path)
    .map((p) => ({ path: p.path as string, url: p.url ?? null, phase: p.phase ?? null }));
  // Catch up any copy that didn't reach SharePoint yet (no-op when there is none).
  after(() => syncJobFiles(jobId));
  return {
    error,
    receipts,
    photos,
    copyLine: summary ? copySummaryLine(summary) : null,
    canRetry: Boolean(summary && (summary.failed > 0 || summary.waiting > 0 || summary.skipped > 0)),
  };
}

export type ReceiptTyped = { vendor: string; amount: string; note: string; purchased_on: string };
/** On an error, what was typed comes back so the form can keep it (React clears fields after an action). */
export type AddReceiptState = { error?: string; saved?: boolean; count?: number | null; typed?: ReceiptTyped } | null;

/** Save one receipt. Used by the office panel and the truck card. */
export async function addJobReceipt(_prev: AddReceiptState, formData: FormData): Promise<AddReceiptState> {
  const result = await saveReceiptFromForm(formData);
  if (!result.error) return result;
  const typed: ReceiptTyped = {
    vendor: String(formData.get("vendor") ?? ""),
    amount: String(formData.get("amount") ?? ""),
    note: String(formData.get("note") ?? ""),
    purchased_on: String(formData.get("purchased_on") ?? ""),
  };
  return { ...result, typed };
}

async function saveReceiptFromForm(formData: FormData): Promise<NonNullable<AddReceiptState>> {
  const jobId = String(formData.get("job_id") ?? "").trim();
  if (!jobId) return { error: "Missing job." };
  const access = await checkJobAccess(jobId, { allowClosedJob: true });
  if (access.error) return { error: access.error };

  const file = formData.get("file");
  if (!(file instanceof Blob) || file.size === 0) return { error: "Add a photo or PDF of the receipt." };
  if (file.size > RECEIPT_MAX_BYTES) return { error: "That file is over 4 MB. Take a photo of it instead." };
  if (file.type && !RECEIPT_TYPES.includes(file.type)) return { error: "Use a photo (JPG, PNG, HEIC) or a PDF." };

  const vendor = String(formData.get("vendor") ?? "").trim().slice(0, 80);
  if (!vendor) return { error: "Where was it bought? Add the vendor." };
  const amountCents = parseMoneyToCents(String(formData.get("amount") ?? ""));
  if (amountCents == null) return { error: "Enter the amount paid, like 42.18." };
  const note = String(formData.get("note") ?? "").trim().slice(0, 300) || null;

  const staffId = await getMyStaffId();
  let staffName: string | null = null;
  if (staffId) {
    const { data } = await supabase.from("staff").select("name").eq("id", staffId).maybeSingle();
    staffName = (data?.name as string | null) ?? null;
  }

  const result = await saveJobReceipt({
    jobId,
    file,
    vendor,
    amountCents,
    purchasedOn: receiptDate(String(formData.get("purchased_on") ?? "")),
    note,
    staffId,
    staffName: staffName ?? (access.role === "tech" ? "Tech" : "Office"),
  });
  if ("error" in result) return { error: result.error };

  revalidatePath("/jobs");
  revalidatePath("/field-board");
  return { saved: true, count: await countReceipts(jobId) };
}

export async function removeReceipt(receiptId: string): Promise<{ error?: string }> {
  try {
    await requireOffice();
  } catch {
    return { error: "Only the office can delete receipts." };
  }
  const result = await deleteJobReceipt(receiptId);
  if ("error" in result) return { error: result.error };
  revalidatePath("/jobs");
  return {};
}

export async function removePhoto(jobId: string, path: string): Promise<{ error?: string }> {
  try {
    await requireOffice();
  } catch {
    return { error: "Only the office can delete photos." };
  }
  if (!jobId || !path) return { error: "Missing photo." };
  try {
    const removed = await removeJobPhoto(jobId, path);
    if (!removed) return { error: "That photo is already gone." };
  } catch {
    return { error: "Couldn't delete the photo. Try again." };
  }
  revalidatePath("/jobs");
  revalidatePath("/field-board");
  return {};
}

/** Office Retry: copy every file of the job that isn't in SharePoint yet, now. */
export async function retryJobFileCopies(jobId: string): Promise<{ error?: string; copyLine?: string | null }> {
  try {
    await requireOffice();
  } catch {
    return { error: "Not allowed" };
  }
  await syncJobFiles(jobId, { force: true });
  const summary = await jobCopySummary(jobId);
  return { copyLine: summary ? copySummaryLine(summary) : null };
}
