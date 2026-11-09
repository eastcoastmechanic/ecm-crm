// Rows for the assistant's list_service_reports tool. Pure helpers, no I/O.
//
// diagnostics has no customer_id. A report reaches a customer through its
// equipment (equipment -> property -> customer) or through its job, the same
// order finishServiceReport uses. No money columns are selected: no
// suggested_line_items, actual_parts_used or invoice totals.

import { one } from "@/lib/appointment-reminder";

export const SERVICE_REPORT_LIST_SELECT =
  "id, doc_number, created_at, completed_at, report_sent_at, ai_diagnosis, job_id, equipment_id, invoice_document_id, " +
  "equipment(type, brand, model, properties(address, customer_id, customers(name))), " +
  "jobs(scheduled_at, status, customer_id, customers(name), properties(address))";

type Rel<T> = T | T[] | null | undefined;
type CustomerRel = { name: string | null };
type PropertyRel = { address: string | null; customer_id?: string | null; customers?: Rel<CustomerRel> };

export type ServiceReportRow = {
  id: string;
  doc_number: string | null;
  created_at: string | null;
  completed_at: string | null;
  report_sent_at: string | null;
  ai_diagnosis: string | null;
  job_id: string | null;
  equipment_id: string | null;
  invoice_document_id: string | null;
  equipment?: Rel<{ type: string | null; brand: string | null; model: string | null; properties?: Rel<PropertyRel> }>;
  jobs?: Rel<{
    scheduled_at: string | null;
    status: string | null;
    customer_id: string | null;
    customers?: Rel<CustomerRel>;
    properties?: Rel<{ address: string | null }>;
  }>;
};

export type ListedServiceReport = {
  id: string;
  doc_number: string | null;
  created_at: string | null;
  finished: boolean;
  emailed_to_customer: boolean;
  has_invoice: boolean;
  invoice_document_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  address: string | null;
  equipment: string | null;
  job_id: string | null;
  job_status: string | null;
  diagnosis: string | null;
};

const DIAGNOSIS_MAX = 400;

/** The report's customer: through its equipment's property first, otherwise its job. */
export function reportCustomerId(row: ServiceReportRow): string | null {
  const property = one(one(row.equipment)?.properties);
  return property?.customer_id ?? one(row.jobs)?.customer_id ?? null;
}

export function toListedServiceReport(row: ServiceReportRow): ListedServiceReport {
  const equipment = one(row.equipment);
  const property = one(equipment?.properties);
  const job = one(row.jobs);
  const fromEquipment = property?.customer_id ? property : null;
  const diagnosis = row.ai_diagnosis?.trim() || null;
  const equipmentLabel = equipment ? [equipment.type, equipment.brand, equipment.model].filter(Boolean).join(" ") : "";
  return {
    id: row.id,
    doc_number: row.doc_number ?? null,
    created_at: row.created_at ?? null,
    finished: Boolean(row.completed_at),
    emailed_to_customer: Boolean(row.report_sent_at),
    has_invoice: Boolean(row.invoice_document_id),
    invoice_document_id: row.invoice_document_id ?? null,
    customer_id: reportCustomerId(row),
    customer_name: (fromEquipment ? one(fromEquipment.customers)?.name : one(job?.customers)?.name) ?? null,
    address: property?.address ?? one(job?.properties)?.address ?? null,
    equipment: equipmentLabel || null,
    job_id: row.job_id ?? null,
    job_status: job?.status ?? null,
    diagnosis: diagnosis && diagnosis.length > DIAGNOSIS_MAX ? `${diagnosis.slice(0, DIAGNOSIS_MAX)}…` : diagnosis,
  };
}

/** Keep rows for one customer, or only unassigned ones, then cap the count. */
export function filterServiceReports(
  rows: ServiceReportRow[],
  opts: { customerId?: string | null; unassignedOnly?: boolean; limit: number }
): ListedServiceReport[] {
  const listed = rows.map(toListedServiceReport).filter((r) => {
    if (opts.unassignedOnly && r.customer_id) return false;
    if (opts.customerId && r.customer_id !== opts.customerId) return false;
    return true;
  });
  return listed.slice(0, opts.limit);
}

/** 1 to 50, default 20. */
export function clampReportLimit(limit: number | null | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return 20;
  return Math.min(50, Math.max(1, Math.floor(limit)));
}
