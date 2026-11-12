import { supabase } from "@/lib/supabase";
import { fetchAllPriceBookItems } from "@/lib/price-book";
import { listSquareCatalog } from "@/lib/square";
import {
  planCatalogImport,
  type ExistingPriceBookRow,
  type NewPriceBookRow,
  type SkipReason,
} from "@/lib/square-catalog-rules";

export const CATALOG_PREVIEW_ROWS = 25;

export type CatalogImportResult = {
  error?: string;
  dryRun: boolean;
  /** False until SQL 0082 is run: preview matches by name only and Import stays off. */
  hasSquareIdColumn: boolean;
  squareItems: number;
  squareVariations: number;
  willCreate: number;
  noPrice: number;
  alreadyThere: number;
  skipped: { reason: SkipReason; count: number }[];
  preview: Pick<NewPriceBookRow, "name" | "category" | "unit_price">[];
  created: number;
  failed: number;
};

export function emptyCatalogResult(dryRun: boolean): CatalogImportResult {
  return {
    dryRun,
    hasSquareIdColumn: false,
    squareItems: 0,
    squareVariations: 0,
    willCreate: 0,
    noPrice: 0,
    alreadyThere: 0,
    skipped: [],
    preview: [],
    created: 0,
    failed: 0,
  };
}

async function readExisting(): Promise<{ rows: ExistingPriceBookRow[]; hasSquareIdColumn: boolean }> {
  try {
    const rows = await fetchAllPriceBookItems<ExistingPriceBookRow>(supabase, "id, name, square_catalog_object_id");
    return { rows, hasSquareIdColumn: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (!/square_catalog_object_id/.test(message)) throw err;
    const rows = await fetchAllPriceBookItems<ExistingPriceBookRow>(supabase, "id, name");
    return { rows, hasSquareIdColumn: false };
  }
}

/**
 * Read only against Square. Dry run counts what would be added; the real run inserts price book rows
 * for Square variations not already in the price book (same Square id or same name). Existing rows,
 * and their prices, are never touched. Safe to run again.
 *
 * New rows are not pushed to the Copilot index one by one (hundreds of calls); the Graph backfill
 * picks them up.
 */
export async function importSquareCatalog(dryRun: boolean): Promise<CatalogImportResult> {
  const out = emptyCatalogResult(dryRun);

  let objects;
  try {
    objects = await listSquareCatalog();
  } catch (err) {
    console.error("Square catalog read failed", err instanceof Error ? err.message : err);
    return { ...out, error: "Couldn't read the Square catalog. Try again in a minute." };
  }

  let existing;
  try {
    existing = await readExisting();
  } catch (err) {
    console.error("price book read failed", err instanceof Error ? err.message : err);
    return { ...out, error: "Couldn't read the price book. Try again." };
  }
  out.hasSquareIdColumn = existing.hasSquareIdColumn;

  const plan = planCatalogImport(objects, existing.rows);
  out.squareItems = plan.squareItems;
  out.squareVariations = plan.squareVariations;
  out.willCreate = plan.toCreate.length;
  out.noPrice = plan.noPrice;
  out.alreadyThere = plan.alreadyThere;
  out.skipped = plan.skipped;
  out.preview = plan.toCreate
    .slice(0, CATALOG_PREVIEW_ROWS)
    .map(({ name, category, unit_price }) => ({ name, category, unit_price }));
  if (dryRun) return out;

  if (!existing.hasSquareIdColumn) {
    return { ...out, error: "Run SQL 0082 in Supabase first, then press Preview again." };
  }

  const rows = plan.toCreate.map((r) => ({
    square_catalog_object_id: r.square_catalog_object_id,
    name: r.name,
    category: r.category,
    description: r.description,
    unit_price: r.unit_price,
    tier: null,
    labor_hours: null,
  }));
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const { error: batchError } = await supabase.from("price_book_items").insert(batch);
    if (!batchError) {
      out.created += batch.length;
      continue;
    }
    // One row clashing with a name or Square id added a moment ago must not sink the other 99.
    for (const row of batch) {
      const { error: rowError } = await supabase.from("price_book_items").insert(row);
      if (!rowError) out.created += 1;
      else if (rowError.code === "23505") out.alreadyThere += 1;
      else {
        console.error("price book import row failed", rowError.code, rowError.message);
        out.failed += 1;
      }
    }
  }
  return out;
}
