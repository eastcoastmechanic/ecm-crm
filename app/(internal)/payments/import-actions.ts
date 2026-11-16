"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/require-role";
import { isSquareConfigured } from "@/lib/square";
import { emptyImportResult, importSquareCustomers, type SquareImportResult } from "@/lib/square-import";

/** Owner only. dry_run=1 only counts; anything else imports. */
export async function runSquareCustomerImport(
  _prev: SquareImportResult | null,
  formData: FormData
): Promise<SquareImportResult> {
  await requireOwner();
  const dryRun = formData.get("dry_run") === "1";
  if (!isSquareConfigured()) {
    return { ...emptyImportResult(dryRun), error: "SQUARE_ACCESS_TOKEN is not set on Vercel." };
  }
  const result = await importSquareCustomers(dryRun);
  if (!dryRun && (result.created || result.linked || result.filled || result.notesAdded || result.propertiesAdded)) {
    revalidatePath("/customers");
    revalidatePath("/properties");
    revalidatePath("/payments");
  }
  return result;
}
