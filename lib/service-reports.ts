import { supabase } from "@/lib/supabase";
import type { ServiceReportPdfData } from "@/lib/service-report-pdf";
import { signStoredPhotos } from "@/lib/photo-urls";

export async function getServiceReportForPdf(id: string): Promise<{
  data: ServiceReportPdfData | null;
  customerEmail: string | null;
  error: string | null;
}> {
  const { data: diagnostic, error } = await supabase
    .from("diagnostics")
    .select(
      "*, equipment(type, brand, model, serial_number, properties(address, customers(name, email)))"
    )
    .eq("id", id)
    .single();

  if (error || !diagnostic) {
    return {
      data: null,
      customerEmail: null,
      error: error?.message ?? "Service report not found",
    };
  }

  const equipment = diagnostic.equipment;
  const readings = diagnostic.readings as ServiceReportPdfData["readings"];

  return {
    data: {
      doc_number: diagnostic.doc_number,
      created_at: diagnostic.created_at,
      customer_name: equipment?.properties?.customers?.name ?? "Customer",
      property_address: equipment?.properties?.address ?? null,
      equipment_label: [equipment?.type, equipment?.brand, equipment?.model]
        .filter(Boolean)
        .join(" "),
      equipment_serial: equipment?.serial_number ?? null,
      readings,
      ai_diagnosis: diagnostic.ai_diagnosis,
      suggested_fix: diagnostic.suggested_fix,
      suggested_line_items: diagnostic.suggested_line_items ?? [],
      // Signed here rather than at render: the PDF fetches each src while it
      // renders and embeds the bytes, so the signature only has to outlive
      // this call, not the finished document.
      photos: await signStoredPhotos(diagnostic.photos ?? []),
    },
    customerEmail: equipment?.properties?.customers?.email ?? null,
    error: null,
  };
}
