import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { syncCustomerToGraph, syncJobToGraph, syncDocumentToGraph } from "@/lib/graph-connector";

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

type Syncable = { type: "customer" | "job" | "document"; id: string };

async function runBatched(items: Syncable[]): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((item) =>
        item.type === "customer"
          ? syncCustomerToGraph(item.id)
          : item.type === "job"
            ? syncJobToGraph(item.id)
            : syncDocumentToGraph(item.id)
      )
    );
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

  const [{ data: customers, error: custErr }, { data: jobs, error: jobErr }, { data: docs, error: docErr }] =
    await Promise.all([
      supabase.from("customers").select("id").order("id"),
      supabase.from("jobs").select("id").order("id"),
      supabase.from("documents").select("id").order("id"),
    ]);

  if (custErr || jobErr || docErr) {
    return NextResponse.json(
      { error: custErr?.message ?? jobErr?.message ?? docErr?.message },
      { status: 500 }
    );
  }

  // One flat, deterministically-ordered list so offset/limit means the same
  // thing across calls regardless of how the three tables split.
  const all: Syncable[] = [
    ...(customers ?? []).map((c) => ({ type: "customer" as const, id: c.id })),
    ...(jobs ?? []).map((j) => ({ type: "job" as const, id: j.id })),
    ...(docs ?? []).map((d) => ({ type: "document" as const, id: d.id })),
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
