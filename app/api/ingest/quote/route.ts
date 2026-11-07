import { NextResponse } from "next/server";
import { ingestQuote, type IngestQuoteBody } from "@/lib/ingest-quote";
import { bearerAuthorized } from "@/lib/bearer-auth";

/**
 * Machine ingest for catalog / field quotes.
 *
 * Auth: `Authorization: Bearer <INGEST_API_KEY>`. Fails closed when the key
 * is not set. (The old shared Basic-auth login is retired.) The in-app
 * Catalog Finalize button uses a server action instead, so it rides the
 * signed-in CRM session.
 */

export async function POST(request: Request) {
  if (!bearerAuthorized(request, process.env.INGEST_API_KEY)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
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
