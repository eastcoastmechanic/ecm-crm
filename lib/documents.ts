import { supabase } from "@/lib/supabase";
import type { PdfDocumentData } from "@/lib/pdf";

export async function getDocumentForPdf(id: string): Promise<{
  data: PdfDocumentData | null;
  customerEmail: string | null;
  error: string | null;
}> {
  const { data: doc, error } = await supabase
    .from("documents")
    .select("*, customers(name, email), properties(address)")
    .eq("id", id)
    .single();

  if (error || !doc) {
    return { data: null, customerEmail: null, error: error?.message ?? "Document not found" };
  }

  const lineData = doc.line_items as {
    items: PdfDocumentData["line_items"];
    brand: PdfDocumentData["brand"];
    mass_save_eligible: boolean;
    mass_save_note: string | null;
    totals: PdfDocumentData["totals"];
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
    },
    customerEmail: doc.customers?.email ?? null,
    error: null,
  };
}
