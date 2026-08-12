import { supabase } from "@/lib/supabase";
import type { AssessmentItem, AssessmentReportPdfData } from "@/lib/assessment-report-pdf";
import { signStoredPhotos } from "@/lib/photo-urls";

export async function getAssessmentReportForPdf(id: string): Promise<{
  data: AssessmentReportPdfData | null;
  customerEmail: string | null;
  error: string | null;
}> {
  const { data: doc, error } = await supabase
    .from("documents")
    .select("*, customers(name, email), properties(address)")
    .eq("id", id)
    .single();

  if (error || !doc) {
    return { data: null, customerEmail: null, error: error?.message ?? "Assessment not found" };
  }

  const lineData = doc.line_items as { items: AssessmentItem[]; overall_summary: string };

  // Photos hang off each assessment item, so they're signed per item. The PDF
  // embeds the bytes at render time, so these signatures only need to outlive
  // this call.
  const items = await Promise.all(
    (lineData.items ?? []).map(async (item) => ({
      ...item,
      photos: await signStoredPhotos(item.photos ?? []),
    }))
  );

  return {
    data: {
      doc_number: doc.doc_number,
      created_at: doc.created_at,
      customer_name: doc.customers?.name ?? "Customer",
      property_address: doc.properties?.address ?? null,
      items,
      overall_summary: lineData.overall_summary,
    },
    customerEmail: doc.customers?.email ?? null,
    error: null,
  };
}
