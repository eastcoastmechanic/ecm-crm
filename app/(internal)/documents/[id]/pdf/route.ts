import { NextResponse } from "next/server";
import { getDocumentForPdf } from "@/lib/documents";
import { renderDocumentPdf } from "@/lib/pdf";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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
