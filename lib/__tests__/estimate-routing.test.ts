/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- vitest isn't on main yet; it lands with PR #29 (chore/ci-lint-tests). Remove this line then.
import { describe, expect, it } from "vitest";
import { depositSplit, idempotencyKey, mapLineItems, paymentRequests, toCents } from "../estimate-routing";

const doc = (over = {}) => ({
  doc_number: "EST-1001",
  subtotal: 1000,
  tax: 0,
  total: 1000,
  line_items: {
    pricing_mode: "flat",
    items: [
      { description: "Mini-split", qty: 1, better: 800 },
      { description: "Labor (2 hr @ $125/hr)", qty: 2, better: 100 },
    ],
  },
  ...over,
});

describe("toCents", () => {
  it("rounds float dollars", () => {
    expect(toCents(19.99)).toBe(1999);
    expect(toCents("0.1")).toBe(10);
    expect(toCents(null)).toBe(0);
  });
});

describe("idempotencyKey", () => {
  const id = "123e4567-e89b-12d3-a456-426614174000";
  it("is stable, within 45 chars, and distinct per kind", () => {
    expect(idempotencyKey("inv", id)).toBe(idempotencyKey("inv", id));
    expect(idempotencyKey("inv", id).length).toBeLessThanOrEqual(45);
    expect(idempotencyKey("inv", id)).not.toBe(idempotencyKey("ord", id));
  });
});

describe("mapLineItems", () => {
  it("maps to cents", () => {
    const r = mapLineItems(doc());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.lines[1]).toEqual({
        name: "Labor (2 hr @ $125/hr)",
        quantity: "2",
        base_price_money: { amount: 10000, currency: "USD" },
      });
      expect(r.totalCents).toBe(100000);
    }
  });
  it("adds tax as a line", () => {
    const r = mapLineItems(doc({ tax: 62.5, total: 1062.5 }));
    expect(r.ok && r.lines.at(-1)?.name).toBe("Sales tax");
  });
  it("rejects mismatched totals, tiered, and empty", () => {
    expect(mapLineItems(doc({ total: 999 })).ok).toBe(false);
    expect(
      mapLineItems(doc({ line_items: { pricing_mode: "tiered", items: [{ description: "x", qty: 1, good: 1 }] } })).ok
    ).toBe(false);
    expect(mapLineItems(doc({ line_items: { items: [] } })).ok).toBe(false);
  });
});

describe("depositSplit", () => {
  it("caps at one-third when 50% exceeds the MA limit", () => {
    expect(depositSplit(100000, 50)).toEqual({ depositCents: 33333, balanceCents: 66667, capped: true });
  });
  it("allows 50% when special-order materials cover it", () => {
    expect(depositSplit(100000, 50, 50000)).toEqual({ depositCents: 50000, balanceCents: 50000, capped: false });
  });
  it("returns null for no deposit", () => {
    expect(depositSplit(100000, 0)).toBeNull();
    expect(depositSplit(100000, 100)).toBeNull();
  });
});

describe("paymentRequests", () => {
  it("single balance request when no deposit", () => {
    const r = paymentRequests(null, "2026-10-21");
    expect(r).toHaveLength(1);
    expect(r[0].request_type).toBe("BALANCE");
  });
  it("deposit then balance", () => {
    const r = paymentRequests({ depositCents: 100, balanceCents: 200, capped: false }, "2026-10-21");
    expect(r.map((x) => x.request_type)).toEqual(["DEPOSIT", "BALANCE"]);
    expect(r[1].due_date).toBe("2026-11-20");
  });
});
