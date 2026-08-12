import { supabase } from "@/lib/supabase";
import type { PdfDocumentData } from "@/lib/pdf";
import { customerFacingJobPhotos, jobIdForDocument } from "@/lib/job-photos";

export async function getDocumentForPdf(id: string): Promise<{
  data: PdfDocumentData | null;
  customerEmail: string | null;
  dueDate: string | null;
  error: string | null;
}> {
  const { data: doc, error } = await supabase
    .from("documents")
    .select("*, customers(name, email), properties(address)")
    .eq("id", id)
    .single();

  if (error || !doc) {
    return {
      data: null,
      customerEmail: null,
      dueDate: null,
      error: error?.message ?? "Document not found",
    };
  }

  const rawLineData = doc.line_items as {
    items?: PdfDocumentData["line_items"];
    brand?: PdfDocumentData["brand"];
    mass_save_eligible?: boolean;
    mass_save_note?: string | null;
    totals?: PdfDocumentData["totals"];
    pricing_mode?: "tiered" | "flat";
  } | null;

  // Some older rows predate the totals/items shape — fall back rather than
  // crash PDF generation / email sending for those documents.
  const lineData = {
    items: rawLineData?.items ?? [],
    brand: rawLineData?.brand ?? { good: null, better: null, best: null },
    mass_save_eligible: rawLineData?.mass_save_eligible ?? false,
    mass_save_note: rawLineData?.mass_save_note ?? null,
    totals: rawLineData?.totals ?? { good: 0, better: 0, best: 0 },
    pricing_mode: rawLineData?.pricing_mode ?? "tiered",
  };

  return {
    data: {
      doc_number: doc.doc_number,
      type: doc.type,
      created_at: doc.created_at,
      customer_name: doc.customers?.name ?? "Customer",
      property_address: doc.properties?.address ?? null,
      line_items: lineData.items,
      brand: lineData.brand,
      mass_save_eligible: lineData.mass_save_eligible,
      mass_save_note: lineData.mass_save_note,
      totals: lineData.totals,
      pricing_mode: lineData.pricing_mode,
      // If this document came out of a job, the arrival/completion photos go
      // on it. That's what makes an invoice defensible: the customer sees the
      // condition they paid to fix, next to the number.
      photos: await customerFacingJobPhotos(await jobIdForDocument(id)),
    },
    customerEmail: doc.customers?.email ?? null,
    dueDate: doc.due_date,
    error: null,
  };
}

/** Invoices default to net-30 the first time they're marked sent. */
export function dueDateForSend(type: string, existingDueDate: string | null): string | undefined {
  if (type !== "invoice" || existingDueDate) return undefined;
  const due = new Date();
  due.setDate(due.getDate() + 30);
  return due.toISOString().slice(0, 10);
}
