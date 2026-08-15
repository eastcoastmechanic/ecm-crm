import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getDocumentForPdf } from "@/lib/documents";
import { renderDocumentPdf } from "@/lib/pdf";
import { getAssessmentReportForPdf } from "@/lib/assessment-reports";
import { renderAssessmentReportPdf } from "@/lib/assessment-report-pdf";
import { getWarrantyReportForPdf } from "@/lib/warranty-reports";
import { renderWarrantyReportPdf } from "@/lib/warranty-report-pdf";
import { getMassSaveRebateFillData } from "@/lib/mass-save-reports";
import { fillMassSaveRebateForm } from "@/lib/mass-save-pdf-fill";
import { getContractForPdf } from "@/lib/contract-reports";
import { renderContractPdf } from "@/lib/contract-pdf";

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

  if (docType?.type === "warranty") {
    const { data, error } = await getWarrantyReportForPdf(id);
    if (error || !data) {
      return NextResponse.json({ error: error ?? "Warranty not found" }, { status: 404 });
    }
    const pdfBuffer = await renderWarrantyReportPdf(data);
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${data.doc_number ?? "warranty"}.pdf"`,
      },
    });
  }

  if (docType?.type === "mass_save_rebate") {
    const { data, docNumber, error } = await getMassSaveRebateFillData(id);
    if (error || !data) {
      return NextResponse.json({ error: error ?? "Rebate application not found" }, { status: 404 });
    }
    const pdfBuffer = await fillMassSaveRebateForm(data);
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${docNumber ?? "mass-save-rebate"}.pdf"`,
      },
    });
  }

  if (docType?.type === "contract") {
    const { data, error } = await getContractForPdf(id);
    if (error || !data) {
      return NextResponse.json({ error: error ?? "Contract not found" }, { status: 404 });
    }
    const pdfBuffer = await renderContractPdf(data);
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${data.doc_number ?? "contract"}.pdf"`,
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
