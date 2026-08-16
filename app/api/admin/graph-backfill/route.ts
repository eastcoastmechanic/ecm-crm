import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  syncCustomerToGraph,
  syncJobToGraph,
  syncDocumentToGraph,
  syncPriceBookItemToGraph,
} from "@/lib/graph-connector";

/**
 * One-time (or re-run-to-reconcile) backfill of every customer/job/document
 * into the Graph external connection. Runs server-side on Vercel rather
 * than as a local script because it needs the service-role Supabase client
 * (lib/supabase.ts) -- the anon key available to local scripts is
 * RLS-restricted and can't see these rows.
 *
 * Paginated via ?offset=&limit= rather than processing everything in one
 * request: pushing ~90 items at Graph's connector endpoint even in batches
 * of 5 with retries ran past the 60s function ceiling (confirmed --
 * "Task timed out after 60 seconds" in Vercel's own logs). A bounded page
 * per call, called repeatedly, stays comfortably under any duration limit;
 * the caller loops on `done`/`nextOffset` until it's false.
 */
const BATCH_SIZE = 5;
const DEFAULT_LIMIT = 25;

export const maxDuration = 60;

type Syncable = { type: "customer" | "job" | "document" | "price_book_item"; id: string };

const SYNC_FN = {
  customer: syncCustomerToGraph,
  job: syncJobToGraph,
  document: syncDocumentToGraph,
  price_book_item: syncPriceBookItemToGraph,
} as const;

async function runBatched(items: Syncable[]): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map((item) => SYNC_FN[item.type](item.id)));
    for (const success of results) {
      if (success) ok++;
      else failed++;
    }
  }
  return { ok, failed };
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const offset = Number(url.searchParams.get("offset") ?? "0");
  const limit = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);

  const [
    { data: customers, error: custErr },
    { data: jobs, error: jobErr },
    { data: docs, error: docErr },
    { data: priceBookItems, error: pbErr },
  ] = await Promise.all([
    supabase.from("customers").select("id").order("id"),
    supabase.from("jobs").select("id").order("id"),
    supabase.from("documents").select("id").order("id"),
    supabase.from("price_book_items").select("id").order("id"),
  ]);

  if (custErr || jobErr || docErr || pbErr) {
    return NextResponse.json(
      { error: custErr?.message ?? jobErr?.message ?? docErr?.message ?? pbErr?.message },
      { status: 500 }
    );
  }

  // One flat, deterministically-ordered list so offset/limit means the same
  // thing across calls regardless of how the tables split.
  const all: Syncable[] = [
    ...(customers ?? []).map((c) => ({ type: "customer" as const, id: c.id })),
    ...(jobs ?? []).map((j) => ({ type: "job" as const, id: j.id })),
    ...(docs ?? []).map((d) => ({ type: "document" as const, id: d.id })),
    ...(priceBookItems ?? []).map((p) => ({ type: "price_book_item" as const, id: p.id })),
  ];

  const page = all.slice(offset, offset + limit);
  const result = await runBatched(page);
  const nextOffset = offset + page.length;

  return NextResponse.json({
    ...result,
    processed: page.length,
    total: all.length,
    nextOffset,
    done: nextOffset >= all.length,
  });
}
