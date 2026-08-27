"use server";

import { revalidatePath } from "next/cache";
import { ingestQuote, type IngestQuoteBody, type IngestQuoteResult } from "@/lib/ingest-quote";

export async function finalizeCatalogQuote(body: IngestQuoteBody): Promise<IngestQuoteResult> {
  const result = await ingestQuote({
    ...body,
    source: body.source ?? "catalog-app",
  });
  if (result.ok) {
    revalidatePath("/documents");
    revalidatePath("/customers");
    revalidatePath("/jobs");
    revalidatePath("/catalog");
  }
  return result;
}
