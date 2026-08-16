import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { syncCustomerToGraph, syncJobToGraph, syncDocumentToGraph } from "@/lib/graph-connector";

/**
 * One-time (or re-run-to-reconcile) backfill of every customer/job/document
 * into the Graph external connection. Runs server-side on Vercel rather
 * than as a local script because it needs the service-role Supabase client
 * (lib/supabase.ts) -- the anon key available to local scripts is
 * RLS-restricted and can't see these rows.
 */
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

  await Promise.all([
    ...(customers ?? []).map((c) => syncCustomerToGraph(c.id)),
    ...(jobs ?? []).map((j) => syncJobToGraph(j.id)),
    ...(docs ?? []).map((d) => syncDocumentToGraph(d.id)),
  ]);

  return NextResponse.json({
    customers: customers?.length ?? 0,
    jobs: jobs?.length ?? 0,
    documents: docs?.length ?? 0,
  });
}
