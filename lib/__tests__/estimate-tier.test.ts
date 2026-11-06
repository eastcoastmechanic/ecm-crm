import { describe, expect, it } from "vitest";
import { approvalChoice, availableTiers, documentTotal, parseTier, selectedTier } from "../estimate-tier";

const totals = { good: 8000, better: 10000, best: 13500 };

describe("approvalChoice", () => {
  it("uses the picked option's total on a tiered estimate", () => {
    expect(approvalChoice({ pricing_mode: "tiered", totals }, "good")).toEqual({ ok: true, tier: "good", total: 8000 });
    expect(approvalChoice({ pricing_mode: "tiered", totals }, "best")).toEqual({ ok: true, tier: "best", total: 13500 });
  });

  it("treats a missing pricing mode as tiered", () => {
    expect(approvalChoice({ totals }, "better")).toEqual({ ok: true, tier: "better", total: 10000 });
    expect(approvalChoice({ totals }, null).ok).toBe(false);
  });

  it("refuses a tiered approval with no pick, a bad pick or an unpriced option", () => {
    expect(approvalChoice({ pricing_mode: "tiered", totals }, "").ok).toBe(false);
    expect(approvalChoice({ pricing_mode: "tiered", totals }, "platinum").ok).toBe(false);
    expect(approvalChoice({ pricing_mode: "tiered", totals: { good: 0, better: 10000, best: 0 } }, "good").ok).toBe(false);
  });

  it("needs no pick on a flat estimate", () => {
    expect(approvalChoice({ pricing_mode: "flat", totals: { good: 500, better: 500, best: 500 } }, null)).toEqual({
      ok: true,
      tier: null,
      total: 500,
    });
  });
});

describe("selectedTier and documentTotal", () => {
  it("reads the stored pick and ignores it on flat estimates", () => {
    expect(selectedTier("tiered", "good")).toBe("good");
    expect(selectedTier(undefined, "best")).toBe("best");
    expect(selectedTier("flat", "good")).toBeNull();
    expect(selectedTier("tiered", "nope")).toBeNull();
    expect(selectedTier("tiered", null)).toBeNull();
  });

  it("keeps the chosen total, defaulting to Better", () => {
    expect(documentTotal(totals, "good")).toBe(8000);
    expect(documentTotal(totals, null)).toBe(10000);
  });
});

describe("availableTiers and parseTier", () => {
  it("lists only priced options", () => {
    expect(availableTiers(totals)).toEqual(["good", "better", "best"]);
    expect(availableTiers({ good: 0, better: 900, best: 1200 })).toEqual(["better", "best"]);
  });

  it("parses only real tier names", () => {
    expect(parseTier("best")).toBe("best");
    expect(parseTier("BEST")).toBeNull();
    expect(parseTier(3)).toBeNull();
  });
});
