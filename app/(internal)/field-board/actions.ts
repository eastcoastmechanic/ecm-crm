"use server";

import { revalidatePath } from "next/cache";
import { ingestFieldBoardEvent } from "@/lib/field-board";

export async function logFieldNote(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const jobId = String(formData.get("job_id") ?? "").trim();
  const boardStatus = String(formData.get("board_status") ?? "").trim();

  const result = await ingestFieldBoardEvent({
    source: "crm-field",
    title: title || body.slice(0, 120),
    body: body || title,
    job_id: jobId || undefined,
    board_status: boardStatus || undefined,
  });

  if (!result.ok) return { error: result.error };
  revalidatePath("/field-board");
  revalidatePath("/jobs");
  return { success: true };
}
