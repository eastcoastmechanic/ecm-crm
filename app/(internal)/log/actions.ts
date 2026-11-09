"use server";

import { revalidatePath } from "next/cache";
import { createLogEntry, setLogFolded } from "@/lib/running-log-store";

// Running log: owner and office only (proxy.ts keeps techs off /log; the store checks
// the role again inside every write). Nothing here deletes.

export type AddLogResult = { error?: string; ok?: boolean; warning?: string };

export async function addLogEntry(formData: FormData): Promise<AddLogResult> {
  const result = await createLogEntry({
    section: formData.get("section"),
    body: formData.get("body"),
    jobId: formData.get("job_id"),
    customerId: formData.get("customer_id"),
  });
  if ("error" in result) return { error: result.error };
  revalidatePath("/log");
  return { ok: true, warning: result.warning };
}

export async function setLogEntryFolded(id: string, folded: boolean): Promise<{ error?: string; ok?: boolean }> {
  const result = await setLogFolded(id, folded);
  if (result.error) return { error: result.error };
  revalidatePath("/log");
  return { ok: true };
}
