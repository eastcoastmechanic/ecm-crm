import { notFound } from "next/navigation";
import ChecklistForm from "../[id]/ChecklistForm";
import PmReportArticle from "../PmReportArticle";
import { itemsFromTemplate } from "@/lib/pm/schema";
import { buildReportModel, toReportItem } from "@/lib/pm/report";
import { RESIDENTIAL_PM_ITEMS } from "@/lib/pm/templates";
import type { PmChecklistItem } from "@/lib/pm/types";

export const dynamic = "force-dynamic";

const PREVIEW_ID = "00000000-0000-4000-8000-000000000001";

function sampleItems(): PmChecklistItem[] {
  const items = itemsFromTemplate(RESIDENTIAL_PM_ITEMS);
  const filters = items.find((item) => item.item_key === "filters");
  const coil = items.find((item) => item.item_key === "evaporator_coil");
  const caps = items.find((item) => item.item_key === "capacitors");
  const temps = items.find((item) => item.item_key === "supply_return");
  const gas = items.find((item) => item.item_key === "burner");
  if (filters) {
    filters.result = "fail";
    filters.notes = "Filter loaded. Replace 16x25x1.";
    filters.readings = { size: "16x25x1", merv: "11" };
  }
  if (coil) coil.result = "pass";
  if (caps) {
    caps.result = "pass";
    caps.readings = { herm_rated_uf: "45", herm_measured_uf: "43.2", fan_rated_uf: "5", fan_measured_uf: "4.8" };
  }
  if (temps) {
    temps.result = "pass";
    temps.readings = { supply_f: "55", return_f: "75", split_f: "20" };
  }
  if (gas) gas.result = "na";
  return items;
}

export default async function PmPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { view } = await searchParams;
  const items = sampleItems();

  if (view === "report") {
    const report = buildReportModel({
      checklist_id: PREVIEW_ID,
      doc_number: "PM-1001",
      date_label: "October 21, 2026",
      tech_name: "Alex Rivera",
      customer_name: "Sample Customer",
      property_address: "1 Example Street, Plymouth, MA",
      equipment_label: "Condenser Carrier 24ACC636A003",
      equipment_serial: "4215C75386",
      audience_label: "Residential",
      recommendations: "Replace the filter and recheck the temperature split on the next visit.",
      items: items.map((item) => toReportItem(item)),
    });
    return <PmReportArticle report={report} />;
  }

  return (
    <ChecklistForm
      checklistId={PREVIEW_ID}
      techName="Alex Rivera"
      recommendations="Replace the filter."
      items={items}
      reportHref="/pm/preview?view=report"
      filed={false}
    />
  );
}
