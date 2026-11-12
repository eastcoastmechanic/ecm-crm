"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/require-role";
import { runSquareHistoryStep } from "@/lib/square-history";
import { newHistoryProgress, parseHistoryProgress, type HistoryProgress } from "@/lib/square-history-map";

/**
 * Owner only. One step of the Square full-history import. Pass `progress: null`
 * to start (dryRun true only counts), then pass back the progress each step
 * returns until `done`.
 */
export async function runSquareHistoryImportStep(input: {
  dryRun: boolean;
  progress: unknown;
}): Promise<{ progress?: HistoryProgress; error?: string }> {
  try {
    await requireOwner();
  } catch {
    return { error: "Only the owner can import Square history." };
  }

  let progress = newHistoryProgress(input.dryRun === true, new Date().toISOString());
  if (input.progress !== null && input.progress !== undefined) {
    const parsed = parseHistoryProgress(input.progress);
    if (!parsed || parsed.dryRun !== (input.dryRun === true)) {
      return { error: "That import progress doesn't look right. Start again." };
    }
    progress = parsed;
  }
  if (progress.done) return { progress };

  const result = await runSquareHistoryStep(progress);
  if (!progress.dryRun && result.progress.done && !result.error) {
    revalidatePath("/payments");
    revalidatePath("/customers");
  }
  return result;
}
