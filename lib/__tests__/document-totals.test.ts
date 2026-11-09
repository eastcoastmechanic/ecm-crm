import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rpc: { data: null as unknown, error: null as null | { code?: string; message: string } },
  rows: { sent: [] as { total: number | null }[], paid: [] as { total: number | null }[] },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: async () => h.rpc,
    from: () => {
      const filters: Record<string, unknown> = {};
      let range: [number, number] = [0, 999];
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.order = () => builder;
      builder.eq = (col: string, value: unknown) => {
        filters[col] = value;
        return builder;
      };
      builder.range = (from: number, to: number) => {
        range = [from, to];
        return builder;
      };
      builder.then = (resolve: (v: unknown) => void) => {
        const rows = filters.status === "sent" ? h.rows.sent : h.rows.paid;
        resolve({ data: rows.slice(range[0], range[1] + 1), error: null });
      };
      return builder;
    },
  },
}));

import { documentMoneyTotals, sumTotals, totalsFromRpc } from "../document-totals";

beforeEach(() => {
  h.rpc = { data: null, error: null };
  h.rows = { sent: [], paid: [] };
});

describe("document money totals", () => {
  it("adds in cents", () => {
    expect(sumTotals([{ total: 0.1 }, { total: 0.2 }, { total: null }, { total: "10.05" }])).toBe(10.35);
  });

  it("reads the SQL function's row", () => {
    expect(totalsFromRpc([{ outstanding_total: "1250.50", outstanding_count: 3, paid_total: 9000 }])).toEqual({
      outstandingTotal: 1250.5,
      outstandingCount: 3,
      paidTotal: 9000,
    });
    expect(totalsFromRpc([])).toBeNull();
  });

  it("uses document_money_totals when SQL 0071 is in", async () => {
    h.rpc = { data: [{ outstanding_total: 500, outstanding_count: 2, paid_total: 1500 }], error: null };
    expect(await documentMoneyTotals()).toEqual({
      totals: { outstandingTotal: 500, outstandingCount: 2, paidTotal: 1500 },
      error: null,
    });
  });

  it("before 0071, pages through every row instead of stopping at 1000", async () => {
    h.rpc = { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
    h.rows.sent = Array.from({ length: 1200 }, () => ({ total: 10 }));
    h.rows.paid = Array.from({ length: 2500 }, () => ({ total: 1 }));
    expect(await documentMoneyTotals()).toEqual({
      totals: { outstandingTotal: 12000, outstandingCount: 1200, paidTotal: 2500 },
      error: null,
    });
  });
});
