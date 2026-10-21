import { NextResponse } from "next/server";
import { checklistReport, getChecklist, isUuid } from "@/lib/pm/db";
import { renderPmReportPdf } from "@/lib/pm/report-pdf";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Checklist not found" }, { status: 404 });
  const { row, error } = await getChecklist(id);
  if (error || !row) return NextResponse.json({ error: error ?? "Checklist not found" }, { status: 404 });
  const report = await checklistReport(row);
  const pdf = await renderPmReportPdf(report);
  const filename = report.doc_number ?? "pm-report";
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}.pdf"`,
    },
  });
}
