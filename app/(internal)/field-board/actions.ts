"use server";

import { revalidatePath } from "next/cache";
import { ingestFieldBoardEvent } from "@/lib/field-board";
import { requireOffice, requireRole } from "@/lib/require-role";
import { getMyStaffId, requireJobAccess } from "@/lib/job-access";
import { startJobEntry } from "@/lib/time-clock";
import { addJobPhotos, markOnWay, updateJobStatus } from "../jobs/actions";

export async function logFieldNote(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const jobId = String(formData.get("job_id") ?? "").trim();
  const boardStatus = String(formData.get("board_status") ?? "").trim();
  const crmStatus = String(formData.get("crm_status") ?? "").trim();

  // Any signed-in staff can leave a note. A tech can only note on a job they may work,
  // and a tech's note never changes status (status moves use the truck buttons).
  const role = await requireRole(["owner", "office", "tech"]);
  if (jobId) await requireJobAccess(jobId, { allowClosedJob: true });
  const isTech = role === "tech";

  const result = await ingestFieldBoardEvent({
    source: "crm-field",
    title: title || body.slice(0, 120),
    body: body || title,
    job_id: jobId || undefined,
    // A tech's note attaches only to the job they picked. No matching by customer name, which
    // could land the note on another tech's job.
    skip_name_match: isTech,
    board_status: isTech ? undefined : boardStatus || undefined,
    crm_status: isTech ? undefined : crmStatus || undefined,
  });

  if (!result.ok) return { error: result.error };
  revalidatePath("/field-board");
  revalidatePath("/jobs");
  return { success: true };
}

export async function setFieldJobStatus(formData: FormData): Promise<void> {
  await requireOffice();
  const jobId = String(formData.get("job_id") ?? "").trim();
  const crmStatus = String(formData.get("crm_status") ?? "").trim();
  if (!jobId || !crmStatus) return;

  const result = await ingestFieldBoardEvent({
    source: "crm-field",
    title: `Status → ${crmStatus.replaceAll("_", " ")}`,
    job_id: jobId,
    crm_status: crmStatus,
    board_status:
      crmStatus === "complete" ? "finished" : crmStatus === "in_progress" ? "active" : crmStatus,
  });

  if (!result.ok) return;
  revalidatePath("/field-board");
  revalidatePath("/jobs");
}

// Truck-screen steps. These go through the same job actions the Jobs page
// uses, so arrived_at, completed_at and tracked_hours are stamped the same way.
export async function truckOnMyWay(formData: FormData): Promise<void> {
  await requireRole(["owner", "office", "tech"]);
  const jobId = String(formData.get("id") ?? "").trim();
  if (!jobId) return;
  await markOnWay(jobId);
  // Drive time starts. Skipped for the shared owner login, which has no staff row.
  const staffId = await getMyStaffId();
  if (staffId) await startJobEntry(jobId, staffId, "drive");
  revalidatePath("/field-board");
}

export async function truckSetStatus(formData: FormData): Promise<void> {
  await requireRole(["owner", "office", "tech"]);
  const status = String(formData.get("status") ?? "").trim();
  if (!String(formData.get("id") ?? "").trim() || !["in_progress", "complete"].includes(status)) return;
  await updateJobStatus(formData);
  // I'm here starts the work timer (and ends drive time). Finish is closed out in applyJobStatus.
  if (status === "in_progress") {
    const staffId = await getMyStaffId();
    const id = String(formData.get("id") ?? "").trim();
    if (staffId) await startJobEntry(id, staffId, "work");
  }
  revalidatePath("/field-board");
}

// One photo per call: each request stays well under Vercel's 4.5MB body cap.
export async function truckAddPhoto(formData: FormData): Promise<{ error?: string }> {
  try {
    await addJobPhotos(formData);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Photo upload failed" };
  }
  revalidatePath("/field-board");
  return {};
}
