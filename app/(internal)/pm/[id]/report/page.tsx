import Link from "next/link";
import { notFound } from "next/navigation";
import { checklistReport, getChecklist, isUuid } from "@/lib/pm/db";
import { buttonSecondaryClass, errorClass } from "../../../ui";
import PmReportArticle from "../../PmReportArticle";
import PrintButton from "./PrintButton";

export const dynamic = "force-dynamic";

export default async function PmReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { row, error } = await getChecklist(id);
  if (error) return <p className={errorClass}>{error}</p>;
  if (!row) notFound();
  const report = await checklistReport(row);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2 print:hidden">
        <Link href={`/pm/${row.id}`} className={buttonSecondaryClass}>
          Back to checklist
        </Link>
        <a href={`/pm/${row.id}/report/pdf`} className={buttonSecondaryClass}>
          Download PDF
        </a>
        <PrintButton className={buttonSecondaryClass} />
      </div>
      <PmReportArticle report={report} />
    </div>
  );
}
