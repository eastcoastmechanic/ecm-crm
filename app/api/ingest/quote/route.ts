import { NextResponse } from "next/server";
import { ingestQuote, type IngestQuoteBody } from "@/lib/ingest-quote";

/**
 * Machine ingest for catalog / field quotes.
 *
 * Auth is the shared internal Basic-Auth gate in proxy.ts — this path is in
 * INTERNAL_API_PATHS so unauthenticated callers get a plain 401, not an HTML
 * login page. The in-app Catalog Finalize button uses a server action instead
 * so it rides the already-authenticated CRM session.
 */

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as IngestQuoteBody | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = await ingestQuote(body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}
