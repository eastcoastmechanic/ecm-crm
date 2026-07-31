import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getDocumentForPdf } from "@/lib/documents";
import { renderDocumentPdf } from "@/lib/pdf";
import { getAssessmentReportForPdf } from "@/lib/assessment-reports";
import { renderAssessmentReportPdf } from "@/lib/assessment-report-pdf";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { data: docType } = await supabase.from("documents").select("type").eq("id", id).single();

  if (docType?.type === "assessment") {
    const { data, error } = await getAssessmentReportForPdf(id);
    if (error || !data) {
      return NextResponse.json({ error: error ?? "Assessment not found" }, { status: 404 });
    }
    const pdfBuffer = await renderAssessmentReportPdf(data);
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${data.doc_number ?? "assessment"}.pdf"`,
      },
    });
  }

  const { data, error } = await getDocumentForPdf(id);

  if (error || !data) {
    return NextResponse.json({ error: error ?? "Document not found" }, { status: 404 });
  }

  const pdfBuffer = await renderDocumentPdf(data);

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${data.doc_number ?? "document"}.pdf"`,
    },
  });
}
