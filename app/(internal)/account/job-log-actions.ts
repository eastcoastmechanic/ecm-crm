"use server";

import { requireOwner } from "@/lib/require-role";
import { rebuildJobLogs } from "@/lib/job-log";

export type RebuildLogsResult = { error?: string; message?: string };

/** Owner: write the job log file for a batch of older jobs whose address already has a folder. */
export async function rebuildJobLogsAction(): Promise<RebuildLogsResult> {
  try {
    await requireOwner();
  } catch {
    return { error: "Owner only." };
  }
  const result = await rebuildJobLogs(10);
  if ("error" in result) return { error: result.error };
  const left = result.remaining == null ? "" : result.remaining === 0 ? " All done." : ` ${result.remaining} left: press again.`;
  const failed = result.failed ? ` ${result.failed} couldn't be written (skipped; any new step on those jobs tries again).` : "";
  return { message: `Wrote ${result.written} job logs.${failed}${left}` };
}
