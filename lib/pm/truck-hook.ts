/**
 * Read contract for the Truck CRM (ecm-field.grok.me).
 *
 * The truck app is not called from here. This is the payload the CRM will
 * return when the truck asks, so a later integration can render a PM visit
 * without scraping HTML. Version the shape; add fields, do not rename them.
 */

import type { PmSummary } from "@/lib/pm/report";

export const TRUCK_PM_HOOK_VERSION = 1;

export type TruckPmChecklist = {
  id: string;
  status: "draft" | "complete";
  job_id: string;
  equipment_id: string;
  template: { slug: string | null; name: string | null };
  tech_name: string | null;
  completed_at: string | null;
  document_id: string | null;
  doc_number: string | null;
  /** Office URL a person can open. The truck should not assume it is public. */
  report_path: string;
  checklist_path: string;
  summary: PmSummary;
  failures: { key: string; label: string; section: string; notes: string | null }[];
};

export type TruckPmPayload = {
  version: typeof TRUCK_PM_HOOK_VERSION;
  job_id: string | null;
  checklists: TruckPmChecklist[];
};

export function truckPmPayload(jobId: string | null, checklists: TruckPmChecklist[]): TruckPmPayload {
  return { version: TRUCK_PM_HOOK_VERSION, job_id: jobId, checklists };
}
