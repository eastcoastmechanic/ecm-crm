import { supabase } from "@/lib/supabase";
import type { WarrantyReportItem, WarrantyReportPdfData } from "@/lib/warranty-report-pdf";

export async function getWarrantyReportForPdf(id: string): Promise<{
  data: WarrantyReportPdfData | null;
  customerEmail: string | null;
  error: string | null;
}> {
  const { data: doc, error } = await supabase
    .from("documents")
    .select("*, customers(name, email), properties(address)")
    .eq("id", id)
    .single();

  if (error || !doc) {
    return { data: null, customerEmail: null, error: error?.message ?? "Warranty not found" };
  }

  const lineData = doc.line_items as { items?: WarrantyReportItem[] } | null;

  return {
    data: {
      doc_number: doc.doc_number,
      created_at: doc.created_at,
      customer_name: doc.customers?.name ?? "Customer",
      property_address: doc.properties?.address ?? null,
      items: lineData?.items ?? [],
    },
    customerEmail: doc.customers?.email ?? null,
    error: null,
  };
}
