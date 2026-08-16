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
 * Pushed in small concurrent batches, not all at once: firing 90+ items at
 * Graph's connector endpoint in parallel reliably drew 502s/504s from it
 * (confirmed against the real endpoint during the first backfill run).
 * pushCrmItem already retries transient 5xxs, so a batch size of 5 clears
 * the rest without hammering it again.
 */
const BATCH_SIZE = 5;

// Batched-with-retries over ~90 items ran past Vercel's default function
// duration and got killed mid-request (FUNCTION_INVOCATION_TIMEOUT) --
// this is a one-off admin trigger, not a hot path, so the plan's max is
// worth spending here instead of restructuring into a background job.
export const maxDuration = 60;

async function runBatched<T>(items: T[], fn: (item: T) => Promise<boolean>): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(fn));
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

  const [{ data: customers, error: custErr }, { data: jobs, error: jobErr }, { data: docs, error: docErr }] =
    await Promise.all([
      supabase.from("customers").select("id"),
      supabase.from("jobs").select("id"),
      supabase.from("documents").select("id"),
    ]);

  if (custErr || jobErr || docErr) {
    return NextResponse.json(
      { error: custErr?.message ?? jobErr?.message ?? docErr?.message },
      { status: 500 }
    );
  }

  const customerResult = await runBatched(customers ?? [], (c) => syncCustomerToGraph(c.id));
  const jobResult = await runBatched(jobs ?? [], (j) => syncJobToGraph(j.id));
  const docResult = await runBatched(docs ?? [], (d) => syncDocumentToGraph(d.id));

  return NextResponse.json({
    customers: customerResult,
    jobs: jobResult,
    documents: docResult,
  });
}
