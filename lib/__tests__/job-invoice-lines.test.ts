import { describe, expect, it } from "vitest";
import {
  BUILT_CATEGORY,
  DEFAULT_MATERIALS_MARKUP_PERCENT,
  buildJobInvoiceLines,
  hourlyLaborRate,
  isBuiltDraft,
  markedUpCents,
  materialsMarkupPercent,
  roundToQuarterHour,
  type TimeEntryForInvoice,
} from "@/lib/job-invoice-lines";

const work = (start: string, end: string | null, extra: Partial<TimeEntryForInvoice> = {}): TimeEntryForInvoice => ({
  kind: "work",
  started_at: `2026-11-13T${start}:00Z`,
  ended_at: end ? `2026-11-13T${end}:00Z` : null,
  ...extra,
});

const base = { jobType: "service", jobNotes: "No heat upstairs", hourlyRate: 125, markupPercent: 35 };

describe("buildJobInvoiceLines", () => {
  it("no clocked time and no receipts: only the work line at $0, with a warning", () => {
    const out = buildJobInvoiceLines({ ...base, timeEntries: [], receipts: [] });
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({ category: BUILT_CATEGORY.work, description: "Service job: No heat upstairs", qty: 1, unit_price: 0 });
    expect(out.laborHours).toBe(0);
    expect(out.totalCents).toBe(0);
    expect(out.warnings.join(" ")).toMatch(/No clocked work time/);
  });

  it("bills closed work time only: voided, still-open and drive timers are skipped", () => {
    const out = buildJobInvoiceLines({
      ...base,
      timeEntries: [
        work("14:00", "15:30"),
        work("09:00", "12:00", { voided_at: "2026-11-13T18:00:00Z" }),
        work("16:00", null),
        { kind: "drive", started_at: "2026-11-13T13:30:00Z", ended_at: "2026-11-13T14:00:00Z" },
      ],
      receipts: [],
    });
    expect(out.laborHours).toBe(1.5);
    expect(out.items[1]).toMatchObject({ category: BUILT_CATEGORY.labor, description: "Labor: 1.5 hrs at $125.00/hr", qty: 1.5, unit: "hr", unit_price: 125 });
    expect(out.totalCents).toBe(18750);
    expect(out.warnings).toEqual([]);
  });

  it("rounds hours to the nearest quarter and says 'hr' for exactly one", () => {
    expect(buildJobInvoiceLines({ ...base, timeEntries: [work("14:00", "15:07")], receipts: [] }).laborHours).toBe(1);
    const one = buildJobInvoiceLines({ ...base, timeEntries: [work("14:00", "15:00")], receipts: [] });
    expect(one.items[1].description).toBe("Labor: 1 hr at $125.00/hr");
    expect(buildJobInvoiceLines({ ...base, timeEntries: [work("14:00", "15:08")], receipts: [] }).laborHours).toBe(1.25);
  });

  it("a few minutes of work rounds to nothing and gets no labor line", () => {
    const out = buildJobInvoiceLines({ ...base, timeEntries: [work("14:00", "14:05")], receipts: [] });
    expect(out.items.map((i) => i.category)).toEqual([BUILT_CATEGORY.work]);
  });

  it("several receipts, each with the markup, in order, to the cent", () => {
    const out = buildJobInvoiceLines({
      ...base,
      timeEntries: [work("14:00", "16:00")],
      receipts: [
        { vendor: "Supply House", note: "igniter", amount_cents: 4218 },
        { vendor: "Hardware Store", note: null, amount_cents: 1999 },
        { vendor: "Pipe Co", note: null, amount_cents: 1 },
      ],
    });
    const materials = out.items.filter((i) => i.category === BUILT_CATEGORY.materials);
    expect(materials.map((m) => m.description)).toEqual(["Materials: Supply House (igniter)", "Materials: Hardware Store", "Materials: Pipe Co"]);
    // 42.18 x 1.35 = 56.943 -> 56.94; 19.99 x 1.35 = 26.9865 -> 26.99; 0.01 x 1.35 = 0.0135 -> 0.01
    expect(materials.map((m) => m.unit_price)).toEqual([56.94, 26.99, 0.01]);
    expect(materials.map((m) => m.cost)).toEqual([42.18, 19.99, 0.01]);
    expect(out.totalCents).toBe(25000 + 5694 + 2699 + 1);
  });

  it("markup 0 bills receipts at cost", () => {
    const out = buildJobInvoiceLines({ ...base, markupPercent: 0, timeEntries: [], receipts: [{ vendor: "X", note: null, amount_cents: 1234 }] });
    expect(out.items[1].unit_price).toBe(12.34);
  });

  it("rate not set: labor line at $0 with a warning, never a guessed rate", () => {
    const out = buildJobInvoiceLines({ ...base, hourlyRate: null, timeEntries: [work("14:00", "16:00")], receipts: [] });
    expect(out.items[1]).toMatchObject({ qty: 2, unit_price: 0, description: "Labor: 2 hrs" });
    expect(out.warnings.join(" ")).toMatch(/HOURLY_LABOR_RATE is not set/);
  });

  it("a receipt with no amount is a $0 line with a warning", () => {
    const out = buildJobInvoiceLines({ ...base, timeEntries: [], receipts: [{ vendor: "Mystery", note: null, amount_cents: null }] });
    expect(out.items[1]).toMatchObject({ unit_price: 0, cost: null });
    expect(out.warnings.join(" ")).toMatch(/Mystery has no amount/);
  });

  it("no notes and no type still makes a readable work line", () => {
    expect(buildJobInvoiceLines({ ...base, jobType: "install", jobNotes: null, timeEntries: [], receipts: [] }).items[0].description).toBe("Install job");
    expect(buildJobInvoiceLines({ ...base, jobType: null, jobNotes: "  a\n b ", timeEntries: [], receipts: [] }).items[0].description).toBe("Service job: a b");
  });

  it("labor at an odd rate rounds the total to the cent", () => {
    const out = buildJobInvoiceLines({ ...base, hourlyRate: 97.33, timeEntries: [work("14:00", "15:15")], receipts: [] });
    // 1.25 x 97.33 = 121.6625 -> 121.66
    expect(out.totalCents).toBe(12166);
  });
});

describe("helpers", () => {
  it("roundToQuarterHour", () => {
    expect(roundToQuarterHour(0)).toBe(0);
    expect(roundToQuarterHour(-1)).toBe(0);
    expect(roundToQuarterHour(1.12)).toBe(1);
    expect(roundToQuarterHour(1.13)).toBe(1.25);
    expect(roundToQuarterHour(2.38)).toBe(2.5);
    expect(roundToQuarterHour(Number.NaN)).toBe(0);
  });

  it("markedUpCents rounds half a cent up", () => {
    expect(markedUpCents(10000, 35)).toBe(13500);
    expect(markedUpCents(10, 35)).toBe(14); // 13.5 -> 14
    expect(markedUpCents(0, 35)).toBe(0);
  });

  it("markup defaults to 35 (owner, 2026-11-13) and the env can override it", () => {
    expect(DEFAULT_MATERIALS_MARKUP_PERCENT).toBe(35);
    expect(materialsMarkupPercent(undefined)).toBe(35);
    expect(materialsMarkupPercent("")).toBe(35);
    expect(materialsMarkupPercent("20")).toBe(20);
    expect(materialsMarkupPercent("12.5%")).toBe(12.5);
    expect(materialsMarkupPercent("0")).toBe(0);
    expect(materialsMarkupPercent("lots")).toBe(35);
    expect(materialsMarkupPercent("-5")).toBe(35);
  });

  it("hourlyLaborRate reads a positive number or null", () => {
    expect(hourlyLaborRate("125")).toBe(125);
    expect(hourlyLaborRate("$125")).toBe(125);
    expect(hourlyLaborRate("")).toBeNull();
    expect(hourlyLaborRate(undefined)).toBeNull();
    expect(hourlyLaborRate("0")).toBeNull();
  });

  it("isBuiltDraft is true only when every line is one the build makes", () => {
    expect(isBuiltDraft([{ category: "Work performed" }, { category: "Labor" }, { category: "Materials" }])).toBe(true);
    expect(isBuiltDraft([{ category: "Labor" }, { category: "Parts" }])).toBe(false);
    expect(isBuiltDraft([{ category: "Contract balance" }])).toBe(false);
    expect(isBuiltDraft([])).toBe(false);
    expect(isBuiltDraft(null)).toBe(false);
  });
});
