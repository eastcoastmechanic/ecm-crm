import { describe, expect, it } from "vitest";
import { approvalChoice, availableTiers, collapseToTier, documentTotal, officeTierUpdate, parseTier, selectedTier, tierTotals } from "../estimate-tier";

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

describe("officeTierUpdate", () => {
  const base = { type: "estimate", pricingMode: "tiered", prevStatus: "sent", prevTier: null, picked: null, totals };

  it("stores the office's pick when it marks a tiered estimate approved", () => {
    expect(officeTierUpdate({ ...base, newStatus: "approved", picked: "good" })).toEqual({ ok: true, tier: "good" });
  });

  it("requires a pick to approve a tiered estimate", () => {
    expect(officeTierUpdate({ ...base, newStatus: "approved" }).ok).toBe(false);
  });

  it("keeps the customer's existing pick on a later save", () => {
    expect(officeTierUpdate({ ...base, newStatus: "approved", prevStatus: "approved", prevTier: "best" })).toEqual({
      ok: true,
      tier: "best",
    });
  });

  it("lets an old approved estimate with no pick be saved as is", () => {
    expect(officeTierUpdate({ ...base, newStatus: "approved", prevStatus: "approved" })).toEqual({ ok: true, tier: null });
  });

  it("refuses an option with no price", () => {
    expect(
      officeTierUpdate({ ...base, newStatus: "approved", picked: "good", totals: { good: 0, better: 10, best: 20 } }).ok
    ).toBe(false);
  });

  it("clears the pick when moved back to draft or sent, and on flat estimates", () => {
    expect(officeTierUpdate({ ...base, newStatus: "sent", prevStatus: "approved", prevTier: "good" })).toEqual({ ok: true, tier: null });
    expect(officeTierUpdate({ ...base, pricingMode: "flat", newStatus: "approved", picked: "good" })).toEqual({ ok: true, tier: null });
  });

  it("leaves non-estimates alone", () => {
    expect(officeTierUpdate({ ...base, type: "invoice", newStatus: "paid", prevTier: null })).toEqual({ ok: true, tier: null });
  });
});

describe("collapseToTier", () => {
  it("puts the picked option's price on every line and total", () => {
    const out = collapseToTier(
      {
        line_items: [{ description: "Heat pump", good: 7000, better: 9000, best: 12000 }],
        totals,
        brand: { good: "Brand A", better: "Brand B", best: "Brand C" },
      },
      "good"
    );
    expect(out.line_items[0]).toEqual({ description: "Heat pump", good: 7000, better: 7000, best: 7000 });
    expect(out.totals).toEqual({ good: 8000, better: 8000, best: 8000 });
    expect(out.brand.better).toBe("Brand A");
    expect(out.pricing_mode).toBe("flat");
    expect(out.chosen_option).toBe("Good");
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

describe("tierTotals", () => {
  it("sums price x qty per option and rounds to cents", () => {
    const items = [
      { qty: 1, good: 7000, better: 9000, best: 12000 },
      { qty: 3, good: 125, better: 125, best: 125 },
      { qty: 2, good: 19.995, better: 19.995, best: 19.995 },
    ];
    expect(tierTotals(items)).toEqual({ good: 7414.99, better: 9414.99, best: 12414.99 });
  });

  it("skips options a line has no price for", () => {
    expect(tierTotals([{ qty: 1, good: null, better: 500, best: 800 }])).toEqual({ good: 0, better: 500, best: 800 });
  });

  it("is zero for no lines", () => {
    expect(tierTotals([])).toEqual({ good: 0, better: 0, best: 0 });
  });
});
