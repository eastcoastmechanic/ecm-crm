"use server";

import { revalidatePath } from "next/cache";
import { ingestFieldBoardEvent } from "@/lib/field-board";

export async function logFieldNote(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const jobId = String(formData.get("job_id") ?? "").trim();
  const boardStatus = String(formData.get("board_status") ?? "").trim();
  const crmStatus = String(formData.get("crm_status") ?? "").trim();

  const result = await ingestFieldBoardEvent({
    source: "crm-field",
    title: title || body.slice(0, 120),
    body: body || title,
    job_id: jobId || undefined,
    board_status: boardStatus || undefined,
    crm_status: crmStatus || undefined,
  });

  if (!result.ok) return { error: result.error };
  revalidatePath("/field-board");
  revalidatePath("/jobs");
  return { success: true };
}

export async function setFieldJobStatus(formData: FormData) {
  const jobId = String(formData.get("job_id") ?? "").trim();
  const crmStatus = String(formData.get("crm_status") ?? "").trim();
  if (!jobId || !crmStatus) return { error: "Job and status required" };

  const result = await ingestFieldBoardEvent({
    source: "crm-field",
    title: `Status → ${crmStatus.replaceAll("_", " ")}`,
    job_id: jobId,
    crm_status: crmStatus,
    board_status: crmStatus === "complete" ? "finished" : crmStatus === "in_progress" ? "active" : crmStatus,
  });

  if (!result.ok) return { error: result.error };
  revalidatePath("/field-board");
  revalidatePath("/jobs");
  return { success: true };
}
