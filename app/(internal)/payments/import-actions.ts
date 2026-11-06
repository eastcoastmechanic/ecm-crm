"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/require-role";
import { isSquareConfigured } from "@/lib/square";
import { importSquareCustomers, type SquareImportResult } from "@/lib/square-import";

/** Owner only. dry_run=1 only counts; anything else imports. */
export async function runSquareCustomerImport(
  _prev: SquareImportResult | null,
  formData: FormData
): Promise<SquareImportResult> {
  await requireOwner();
  const dryRun = formData.get("dry_run") === "1";
  if (!isSquareConfigured()) {
    return { dryRun, error: "SQUARE_ACCESS_TOKEN is not set on Vercel.", squareTotal: 0, willCreate: 0, willLink: 0, alreadyLinked: 0, skipped: 0, created: 0, linked: 0, failed: 0 };
  }
  const result = await importSquareCustomers(dryRun);
  if (!dryRun && !result.error) {
    revalidatePath("/customers");
    revalidatePath("/payments");
  }
  return result;
}
