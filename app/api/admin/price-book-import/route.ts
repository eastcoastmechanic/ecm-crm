import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { syncPriceBookItemToGraph } from "@/lib/graph-connector";
import catalog from "@/scripts/data/ecm-price-book-2026-08.json";

/**
 * One-time import of the real Daikin/Goodman catalog (536 items, extracted
 * from ~/Downloads/ECM-Price-Book.html via scripts/extract-price-book-html.mjs)
 * into price_book_items. Confirmed with Josh before running: these are
 * already sell prices (no markup math needed), and the existing ~1000-item
 * price book may overlap with this catalog, so duplicates are skipped by
 * exact name match rather than blindly inserted.
 *
 * Naming matches the established convention -- "{category} {model}",
 * trailing '*' kept as-is -- so a name collision here means the same
 * naming a human would have typed by hand, not a coincidence.
 *
 * ?dryRun=1 previews insert/skip counts (plus a short sample) without
 * writing anything -- worth checking before committing 500+ real pricing
 * rows.
 */
export const maxDuration = 60;

type CatalogItem = {
  cat: string;
  series?: string;
  model: string;
  desc?: string;
  price: number;
};

function computeName(item: CatalogItem): string {
  return `${item.cat} ${item.model}`.replace(/\s+/g, " ").trim();
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const offset = Number(url.searchParams.get("offset") ?? "0");
  const limit = Number(url.searchParams.get("limit") ?? "20");

  const { data: existing, error: existingErr } = await supabase.from("price_book_items").select("name");
  if (existingErr) return NextResponse.json({ error: existingErr.message }, { status: 500 });

  const existingNames = new Set((existing ?? []).map((r) => (r.name ?? "").trim().toLowerCase()));

  const items = catalog as CatalogItem[];
  const toInsert: { item: CatalogItem; name: string }[] = [];
  const seenInBatch = new Set<string>();
  let skippedAsDuplicate = 0;

  for (const item of items) {
    const name = computeName(item);
    const key = name.toLowerCase();
    if (existingNames.has(key) || seenInBatch.has(key)) {
      skippedAsDuplicate++;
      continue;
    }
    seenInBatch.add(key);
    toInsert.push({ item, name });
  }

  if (dryRun) {
    return NextResponse.json({
      totalInCatalog: items.length,
      wouldInsert: toInsert.length,
      wouldSkipAsDuplicate: skippedAsDuplicate,
      sampleInserts: toInsert.slice(0, 10).map((x) => ({ name: x.name, price: x.item.price })),
    });
  }

  const page = toInsert.slice(offset, offset + limit);
  let inserted = 0;
  let failed = 0;

  for (const { item, name } of page) {
    const { data: row, error } = await supabase
      .from("price_book_items")
      .insert({
        category: item.cat,
        tier: null,
        name,
        description: item.desc || null,
        unit_price: item.price,
        labor_hours: null,
      })
      .select("id")
      .single();

    if (error || !row) {
      console.error(`[price-book-import] insert failed for "${name}": ${error?.message}`);
      failed++;
      continue;
    }
    inserted++;
    await syncPriceBookItemToGraph(row.id);
  }

  const nextOffset = offset + page.length;

  return NextResponse.json({
    inserted,
    failed,
    processed: page.length,
    totalToInsert: toInsert.length,
    nextOffset,
    done: nextOffset >= toInsert.length,
  });
}
