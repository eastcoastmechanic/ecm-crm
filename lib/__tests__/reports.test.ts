import { describe, expect, it } from "vitest";
import {
  etMonthKey,
  hoursByJob,
  jobProfit,
  leadSources,
  NOT_LINKED,
  partsCost,
  partsCostFromDocs,
  revenueByType,
} from "../reports";

describe("etMonthKey", () => {
  it("uses the New York month, not UTC", () => {
    // 11:30 PM Oct 31 in New York is already Nov 1 in UTC.
    expect(etMonthKey("2026-11-01T03:30:00Z")).toBe("2026-10");
    expect(etMonthKey("2026-11-01T05:00:00Z")).toBe("2026-11");
  });
});

describe("partsCost", () => {
  it("adds cost times quantity", () => {
    expect(partsCost([{ qty: 2, better: 100, cost: 40 }, { qty: 1, better: 50, cost: 10.5 }])).toEqual({
      cost: 90.5,
      incomplete: false,
    });
  });

  it("flags a priced line with no cost instead of calling it free", () => {
    expect(partsCost([{ qty: 1, better: 100, cost: 40 }, { qty: 1, better: 300, cost: null }])).toEqual({
      cost: 40,
      incomplete: true,
    });
  });

  it("ignores unpriced lines with no cost (notes, headings)", () => {
    expect(partsCost([{ qty: 1, better: null, cost: null }]).incomplete).toBe(false);
  });
});

describe("partsCostFromDocs", () => {
  it("is null when no document has line items (contract with no estimate)", () => {
    expect(partsCostFromDocs([null])).toBeNull();
  });

  it("marks the cost incomplete when one pricing document has no items", () => {
    expect(partsCostFromDocs([[{ qty: 1, better: 100, cost: 30 }], null])).toEqual({ cost: 30, incomplete: true });
  });

  it("adds across documents", () => {
    expect(
      partsCostFromDocs([[{ qty: 1, better: 100, cost: 30 }], [{ qty: 2, better: 50, cost: 5 }]])
    ).toEqual({ cost: 40, incomplete: false });
  });
});

describe("hoursByJob", () => {
  it("sums finished entries per job and skips open ones", () => {
    const map = hoursByJob([
      { job_id: "a", started_at: "2026-11-02T13:00:00Z", ended_at: "2026-11-02T15:30:00Z" },
      { job_id: "a", started_at: "2026-11-02T16:00:00Z", ended_at: "2026-11-02T16:30:00Z" },
      { job_id: "b", started_at: "2026-11-02T13:00:00Z", ended_at: null },
    ]);
    expect(map.get("a")).toBe(3);
    expect(map.has("b")).toBe(false);
  });
});

describe("jobProfit", () => {
  it("price minus parts minus labor", () => {
    const p = jobProfit({ price: 1000, parts: { cost: 300, incomplete: false }, hours: 4, hourlyRate: 125 });
    expect(p).toEqual({ price: 1000, parts: 300, labor: 500, profit: 200, margin: 20, gaps: [] });
  });

  it("no profit number without a price", () => {
    const p = jobProfit({ price: null, parts: null, hours: 2, hourlyRate: 125 });
    expect(p.profit).toBeNull();
    expect(p.gaps).toContain("no price linked");
  });

  it("says what is missing when the number is partial", () => {
    const p = jobProfit({ price: 800, parts: { cost: 100, incomplete: true }, hours: null, hourlyRate: 125 });
    expect(p.profit).toBe(700);
    expect(p.gaps).toEqual(["some part costs missing", "no hours"]);
  });

  it("does not invent a labor rate", () => {
    const p = jobProfit({ price: 800, parts: { cost: 0, incomplete: false }, hours: 3, hourlyRate: null });
    expect(p.labor).toBeNull();
    expect(p.gaps).toContain("labor rate not set");
  });
});

describe("revenueByType", () => {
  it("groups by job type and keeps unlinked money as its own row, last", () => {
    expect(
      revenueByType([
        { total: 500, jobType: null },
        { total: 1000, jobType: "install" },
        { total: 200, jobType: "service" },
        { total: 300, jobType: "service" },
        { total: 0, jobType: "service" },
      ])
    ).toEqual([
      { type: "install", count: 1, total: 1000 },
      { type: "service", count: 2, total: 500 },
      { type: NOT_LINKED, count: 1, total: 500 },
    ]);
  });
});

describe("leadSources", () => {
  it("counts stages per source and wins out of decided leads", () => {
    const rows = leadSources([
      { source: "web", status: "won" },
      { source: "web", status: "lost" },
      { source: "web", status: "won" },
      { source: "web", status: "new" },
      { source: "manual", status: "dismissed" },
    ]);
    expect(rows[0]).toMatchObject({ source: "web", total: 4, winRate: 67 });
    expect(rows[0].stages).toMatchObject({ won: 2, lost: 1, new: 1 });
    expect(rows[1]).toMatchObject({ source: "manual", winRate: null });
    expect(rows[1].stages.other).toBe(1);
  });
});
