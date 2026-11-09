import { describe, expect, it } from "vitest";
import {
  SERVICE_REPORT_LIST_SELECT,
  clampReportLimit,
  filterServiceReports,
  reportCustomerId,
  toListedServiceReport,
  type ServiceReportRow,
} from "../service-report-list";

function row(over: Partial<ServiceReportRow> = {}): ServiceReportRow {
  return {
    id: "d1",
    doc_number: "RPT-1001",
    created_at: "2026-11-01T14:00:00Z",
    completed_at: null,
    report_sent_at: null,
    ai_diagnosis: "Weak run capacitor",
    job_id: null,
    equipment_id: null,
    invoice_document_id: null,
    equipment: null,
    jobs: null,
    ...over,
  };
}

const viaEquipment = row({
  id: "eq",
  equipment_id: "e1",
  equipment: { type: "Condenser", brand: "Carrier", model: "24ABC", properties: { address: "1 Main St", customer_id: "c1", customers: { name: "A" } } },
});
const viaJob = row({
  id: "job",
  job_id: "j1",
  jobs: [{ scheduled_at: null, status: "complete", customer_id: "c2", customers: [{ name: "B" }], properties: [{ address: "2 Elm St" }] }],
});
const unassigned = row({ id: "none" });

describe("SERVICE_REPORT_LIST_SELECT", () => {
  it("reads no money columns and no columns diagnostics does not have", () => {
    for (const col of ["suggested_line_items", "actual_parts_used", "total", "unit_price", "technician_name", "symptom", "customer_id, equipment"]) {
      expect(SERVICE_REPORT_LIST_SELECT).not.toContain(col);
    }
    expect(SERVICE_REPORT_LIST_SELECT).toContain("ai_diagnosis");
  });
});

describe("reportCustomerId", () => {
  it("comes from the equipment's property first", () => {
    expect(reportCustomerId(viaEquipment)).toBe("c1");
  });
  it("falls back to the job's customer", () => {
    expect(reportCustomerId(viaJob)).toBe("c2");
  });
  it("prefers equipment when both are set", () => {
    expect(reportCustomerId({ ...viaJob, equipment: viaEquipment.equipment })).toBe("c1");
  });
  it("is null when neither links a customer", () => {
    expect(reportCustomerId(unassigned)).toBeNull();
  });
});

describe("toListedServiceReport", () => {
  it("names the customer, address and equipment and flags status", () => {
    const listed = toListedServiceReport({ ...viaEquipment, completed_at: "2026-11-02T00:00:00Z", invoice_document_id: "inv1" });
    expect(listed).toMatchObject({
      customer_id: "c1",
      customer_name: "A",
      address: "1 Main St",
      equipment: "Condenser Carrier 24ABC",
      finished: true,
      emailed_to_customer: false,
      has_invoice: true,
    });
  });
  it("reads job relations returned as arrays", () => {
    expect(toListedServiceReport(viaJob)).toMatchObject({ customer_name: "B", address: "2 Elm St", job_status: "complete" });
  });
  it("shortens a long diagnosis", () => {
    const listed = toListedServiceReport(row({ ai_diagnosis: "x".repeat(1000) }));
    expect(listed.diagnosis!.length).toBe(401);
  });
});

describe("filterServiceReports", () => {
  const rows = [viaEquipment, viaJob, unassigned];
  it("keeps one customer's reports", () => {
    expect(filterServiceReports(rows, { customerId: "c2", limit: 20 }).map((r) => r.id)).toEqual(["job"]);
  });
  it("keeps only unassigned reports", () => {
    expect(filterServiceReports(rows, { unassignedOnly: true, limit: 20 }).map((r) => r.id)).toEqual(["none"]);
  });
  it("caps the count", () => {
    expect(filterServiceReports(rows, { limit: 2 })).toHaveLength(2);
  });
});

describe("clampReportLimit", () => {
  it("defaults to 20 and stays between 1 and 50", () => {
    expect(clampReportLimit(undefined)).toBe(20);
    expect(clampReportLimit(0)).toBe(1);
    expect(clampReportLimit(500)).toBe(50);
    expect(clampReportLimit(7.9)).toBe(7);
  });
});
