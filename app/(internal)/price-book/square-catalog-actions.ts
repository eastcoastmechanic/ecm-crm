"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/require-role";
import { isSquareConfigured } from "@/lib/square";
import { emptyCatalogResult, importSquareCatalog, type CatalogImportResult } from "@/lib/square-catalog-import";

/** Owner only. dry_run=1 only counts and previews; anything else imports. Returns { error }, never throws. */
export async function runSquareCatalogImport(
  _prev: CatalogImportResult | null,
  formData: FormData
): Promise<CatalogImportResult> {
  const dryRun = formData.get("dry_run") === "1";
  try {
    await requireOwner();
  } catch {
    return { ...emptyCatalogResult(dryRun), error: "Only the owner can import from Square." };
  }
  if (!isSquareConfigured()) {
    return { ...emptyCatalogResult(dryRun), error: "SQUARE_ACCESS_TOKEN is not set on Vercel." };
  }
  const result = await importSquareCatalog(dryRun);
  if (!dryRun && result.created > 0) {
    revalidatePath("/price-book");
    revalidatePath("/catalog");
  }
  return result;
}
