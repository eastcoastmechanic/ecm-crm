import { NextResponse } from "next/server";
import { getServiceReportForPdf } from "@/lib/service-reports";
import { renderServiceReportPdf } from "@/lib/service-report-pdf";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { data, error } = await getServiceReportForPdf(id);

  if (error || !data) {
    return NextResponse.json({ error: error ?? "Service report not found" }, { status: 404 });
  }

  const pdfBuffer = await renderServiceReportPdf(data);

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${data.doc_number ?? "service-report"}.pdf"`,
    },
  });
}
