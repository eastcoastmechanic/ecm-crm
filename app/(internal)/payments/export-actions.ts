"use server";

import { requireOwner } from "@/lib/require-role";
import { exportSquareToSharePoint, type SquareExportResult } from "@/lib/square-export";

/** Owner only. Reads Square (read only) and saves CSVs to SharePoint. */
export async function runSquareExport(): Promise<SquareExportResult> {
  try {
    await requireOwner();
  } catch {
    return { error: "Only the owner can export Square." };
  }
  return exportSquareToSharePoint();
}
