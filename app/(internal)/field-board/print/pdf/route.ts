import { NextResponse } from "next/server";
import { getFieldSheetPayload } from "@/lib/field-sheet";
import { renderFieldSheetPdf } from "@/lib/field-sheet-pdf";

export const dynamic = "force-dynamic";

export async function GET() {
  const sheet = await getFieldSheetPayload();
  const pdfBuffer = await renderFieldSheetPdf(sheet);
  const stamp = sheet.dateLabel.replaceAll(",", "").replaceAll(" ", "-");
  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="ECM-Field-Sheet-${stamp}.pdf"`,
    },
  });
}
