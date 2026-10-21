import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COMMERCIAL_PM_ITEMS,
  PM_TEMPLATES,
  REQUIRED_COMMERCIAL_KEYS,
  REQUIRED_RESIDENTIAL_KEYS,
  RESIDENTIAL_PM_ITEMS,
} from "@/lib/pm/templates";
import { itemsFromTemplate, parseTemplateItems } from "@/lib/pm/schema";
import { buildReportModel, documentSnapshot, temperatureSplit, toReportItem } from "@/lib/pm/report";
import { truckPmPayload, TRUCK_PM_HOOK_VERSION } from "@/lib/pm/truck-hook";

describe("PM templates", () => {
  it("covers the residential list and adds rooftop items for commercial", () => {
    const residential = new Set(RESIDENTIAL_PM_ITEMS.map((item) => item.key));
    const commercial = new Set(COMMERCIAL_PM_ITEMS.map((item) => item.key));
    for (const key of REQUIRED_RESIDENTIAL_KEYS) expect(residential.has(key)).toBe(true);
    for (const key of REQUIRED_COMMERCIAL_KEYS) {
      expect(commercial.has(key)).toBe(true);
      expect(residential.has(key)).toBe(false);
    }
    expect(PM_TEMPLATES.map((template) => template.slug)).toEqual(["residential", "commercial"]);
  });

  it("gives capacitors, pressures, temperatures, amps, combustion, and gas pressure their units", () => {
    const byKey = new Map(RESIDENTIAL_PM_ITEMS.map((item) => [item.key, item]));
    expect(byKey.get("capacitors")?.readings.map((field) => field.unit)).toEqual(["µF", "µF", "µF", "µF"]);
    expect(byKey.get("suction_pressure")?.readings[0]?.unit).toBe("psig");
    expect(byKey.get("supply_return")?.readings.map((field) => field.key)).toEqual(["supply_f", "return_f", "split_f"]);
    expect(byKey.get("compressor_amps")?.readings.map((field) => field.label)).toEqual(["Measured", "RLA"]);
    expect(byKey.get("co_ambient")?.readings[0]?.unit).toBe("ppm");
    expect(byKey.get("gas_pressure")?.readings.map((field) => field.unit)).toEqual(["in. w.c.", "in. w.c."]);
    expect(byKey.get("static_pressure")?.readings[0]?.unit).toBe("in. w.c.");
  });

  it("is valid template data, and the migration seeds every item key", () => {
    const parsed = parseTemplateItems(RESIDENTIAL_PM_ITEMS);
    expect(parsed.error).toBeUndefined();
    const sql = readFileSync("db/migrations/0048_preventive_maintenance.sql", "utf8");
    for (const template of PM_TEMPLATES) {
      expect(sql).toContain(`'${template.slug}'`);
      for (const item of template.items) expect(sql).toContain(`"key":"${item.key}"`);
    }
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("'pm_report'");
  });
});

describe("report model", () => {
  it("lists failures, hides blank readings, and computes a cooling split", () => {
    expect(temperatureSplit("55", "75")).toBe("20");
    expect(temperatureSplit("", "75")).toBeNull();

    const [filters, coil] = itemsFromTemplate(RESIDENTIAL_PM_ITEMS.filter((item) => item.key === "filters" || item.key === "evaporator_coil"));
    filters.result = "fail";
    filters.notes = "Loaded";
    filters.readings = { size: "16x25x1", merv: "" };
    coil.result = "pass";

    const model = buildReportModel({
      checklist_id: "chk",
      doc_number: "PM-1001",
      date_label: "October 21, 2026",
      tech_name: "Alex",
      customer_name: "Sample Customer",
      property_address: "1 Example St",
      equipment_label: "Condenser — Carrier 24ACC",
      equipment_serial: "4215C75386",
      audience_label: "Residential",
      recommendations: "Replace the filter.",
      items: [toReportItem(filters), toReportItem(coil)],
    });

    expect(model.summary).toEqual({ pass: 1, fail: 1, na: 0, open: 0 });
    expect(model.failures.map((item) => item.label)).toEqual(["Filters"]);
    expect(model.failures[0]?.readings).toEqual([{ label: "Filter size", value: "16x25x1" }]);
    expect(model.sections[0]?.name).toBe("Airflow");

    const snapshot = documentSnapshot({
      checklist_id: "chk",
      template_slug: "residential",
      tech_name: "Alex",
      recommendations: "Replace the filter.",
      items: [filters, coil],
    });
    expect(snapshot.kind).toBe("pm_report");
    expect(snapshot.failures).toHaveLength(1);
  });
});

describe("truck hook", () => {
  it("returns a versioned payload and does not invent checklists", () => {
    const payload = truckPmPayload("job-1", []);
    expect(payload).toEqual({ version: TRUCK_PM_HOOK_VERSION, job_id: "job-1", checklists: [] });
  });
});
