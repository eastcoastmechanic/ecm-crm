import type { PmChecklistItem, PmReportItem, PmReportModel, PmReportReading, PmResult } from "@/lib/pm/types";

export type PmSummary = { pass: number; fail: number; na: number; open: number };

export function summarizeItems(items: { result: PmResult | null }[]): PmSummary {
  const summary: PmSummary = { pass: 0, fail: 0, na: 0, open: 0 };
  for (const item of items) {
    if (item.result === "pass") summary.pass += 1;
    else if (item.result === "fail") summary.fail += 1;
    else if (item.result === "na") summary.na += 1;
    else summary.open += 1;
  }
  return summary;
}

export function readingsForReport(item: PmChecklistItem): PmReportReading[] {
  const readings: PmReportReading[] = [];
  for (const field of item.reading_fields) {
    const value = (item.readings[field.key] ?? "").trim();
    if (!value) continue;
    readings.push({ label: field.label, value, unit: field.unit });
  }
  return readings;
}

export function toReportItem(
  item: PmChecklistItem,
  photos: { url: string | null; caption: string | null }[] = []
): PmReportItem {
  return {
    key: item.item_key,
    section: item.section,
    label: item.label,
    result: item.result,
    notes: item.notes?.trim() ? item.notes.trim() : null,
    readings: readingsForReport(item),
    photos,
  };
}

export function groupReportSections(items: PmReportItem[]): { name: string; items: PmReportItem[] }[] {
  const sections: { name: string; items: PmReportItem[] }[] = [];
  for (const item of items) {
    const current = sections[sections.length - 1];
    if (!current || current.name !== item.section) {
      sections.push({ name: item.section, items: [item] });
    } else {
      current.items.push(item);
    }
  }
  return sections;
}

/** Cooling temperature split (return − supply), rounded to 0.1°F. Null when either temp is blank. */
export function temperatureSplit(supply: string, returnAir: string): string | null {
  const supplyN = Number(supply);
  const returnN = Number(returnAir);
  if (!supply.trim() || !returnAir.trim() || !Number.isFinite(supplyN) || !Number.isFinite(returnN)) return null;
  return String(Math.round(Math.abs(returnN - supplyN) * 10) / 10);
}

/**
 * Writes one reading. Supply and return keep the temperature split in step
 * while it still matches the previous pair (or is blank). A split the tech
 * typed by hand is left alone.
 */
export function applyReadingChange(
  itemKey: string,
  readings: Record<string, string>,
  fieldKey: string,
  value: string,
): Record<string, string> {
  const next = { ...readings, [fieldKey]: value };
  if (itemKey !== "supply_return" || (fieldKey !== "supply_f" && fieldKey !== "return_f")) return next;

  const previousAuto = temperatureSplit(readings.supply_f ?? "", readings.return_f ?? "");
  const currentSplit = (readings.split_f ?? "").trim();
  const typedByHand = currentSplit !== "" && currentSplit !== (previousAuto ?? "");
  if (typedByHand) return next;

  next.split_f = temperatureSplit(next.supply_f ?? "", next.return_f ?? "") ?? "";
  return next;
}

export function openItemLabels(items: PmChecklistItem[]): string[] {
  return items.filter((item) => item.result == null).map((item) => item.label);
}

export function buildReportModel(input: {
  checklist_id: string;
  doc_number: string | null;
  date_label: string;
  tech_name: string | null;
  customer_name: string;
  property_address: string | null;
  equipment_label: string;
  equipment_serial: string | null;
  audience_label: string;
  recommendations: string | null;
  items: PmReportItem[];
}): PmReportModel {
  return {
    doc_number: input.doc_number,
    checklist_id: input.checklist_id,
    title: "Startup / Preventive Maintenance Report",
    date_label: input.date_label,
    tech_name: input.tech_name,
    customer_name: input.customer_name,
    property_address: input.property_address,
    equipment_label: input.equipment_label,
    equipment_serial: input.equipment_serial,
    audience_label: input.audience_label,
    recommendations: input.recommendations?.trim() ? input.recommendations.trim() : null,
    summary: summarizeItems(input.items),
    failures: input.items.filter((item) => item.result === "fail"),
    sections: groupReportSections(input.items),
  };
}

export type PmDocumentSnapshot = {
  kind: "pm_report";
  checklist_id: string;
  template_slug: string | null;
  tech_name: string | null;
  recommendations: string | null;
  summary: PmSummary;
  failures: { key: string; section: string; label: string; notes: string | null; readings: PmReportReading[] }[];
  items: {
    key: string;
    section: string;
    label: string;
    result: PmResult | null;
    notes: string | null;
    readings: PmReportReading[];
  }[];
};

export function documentSnapshot(input: {
  checklist_id: string;
  template_slug: string | null;
  tech_name: string | null;
  recommendations: string | null;
  items: PmChecklistItem[];
}): PmDocumentSnapshot {
  const reportItems = input.items.map((item) => toReportItem(item));
  return {
    kind: "pm_report",
    checklist_id: input.checklist_id,
    template_slug: input.template_slug,
    tech_name: input.tech_name,
    recommendations: input.recommendations?.trim() ? input.recommendations.trim() : null,
    summary: summarizeItems(reportItems),
    failures: reportItems
      .filter((item) => item.result === "fail")
      .map((item) => ({
        key: item.key,
        section: item.section,
        label: item.label,
        notes: item.notes,
        readings: item.readings,
      })),
    items: reportItems.map((item) => ({
      key: item.key,
      section: item.section,
      label: item.label,
      result: item.result,
      notes: item.notes,
      readings: item.readings,
    })),
  };
}
