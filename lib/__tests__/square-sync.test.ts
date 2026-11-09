import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake Supabase that honors .range() like the real one: a select without a
// range would get everything, but sync must page, and a row past the first page
// must still be found.
const h = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  ranges: [] as { table: string; from: number; to: number }[],
  updates: [] as { table: string; patch: Record<string, unknown>; filters: [string, unknown][] }[],
  upserts: [] as { table: string; rows: unknown[] }[],
  paid: [] as { id: string; opts: unknown }[],
  invoices: [] as Record<string, unknown>[],
  payments: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      let mode: "select" | "update" | "upsert" = "select";
      let patch: Record<string, unknown> = {};
      let range: [number, number] | null = null;
      const filters: [string, unknown][] = [];
      let inFilter: [string, unknown[]] | null = null;
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.order = () => builder;
      builder.in = (col: string, values: unknown[]) => {
        inFilter = [col, values];
        return builder;
      };
      builder.eq = (col: string, value: unknown) => {
        filters.push([col, value]);
        return builder;
      };
      builder.range = (from: number, to: number) => {
        range = [from, to];
        h.ranges.push({ table, from, to });
        return builder;
      };
      builder.update = (p: Record<string, unknown>) => {
        mode = "update";
        patch = p;
        return builder;
      };
      builder.upsert = (rows: unknown[]) => {
        h.upserts.push({ table, rows });
        mode = "upsert";
        return builder;
      };
      builder.then = (resolve: (v: unknown) => void) => {
        if (mode === "update") {
          h.updates.push({ table, patch, filters });
          return resolve({ error: null });
        }
        if (mode === "upsert") return resolve({ error: null });
        let rows = h.tables[table] ?? [];
        if (inFilter) {
          const [col, values] = inFilter;
          rows = rows.filter((r) => values.includes(r[col]));
        }
        // Real PostgREST caps an unranged select at 1000 rows.
        const [from, to] = range ?? [0, 999];
        resolve({ data: rows.slice(from, to + 1), error: null });
      };
      return builder;
    },
  },
}));

vi.mock("@/lib/square", () => ({
  isSquareConfigured: () => true,
  getSquareLocationId: () => "LOC1",
  listSquarePayments: async () => h.payments,
  listSquareInvoices: async () => h.invoices,
  bulkRetrieveSquareCustomers: async () => new Map(),
}));

vi.mock("@/lib/document-paid", () => ({
  markDocumentPaid: async (id: string, opts: unknown) => {
    h.paid.push({ id, opts });
    return { updated: true };
  },
}));

import { syncSquarePayments } from "../square-sync";

function doc(i: number, over: Record<string, unknown> = {}) {
  return {
    id: `doc-${i}`,
    doc_number: `INV-${1001 + i}`,
    type: "invoice",
    status: "sent",
    total: 100,
    customer_id: null,
    square_invoice_id: null,
    paid_at: null,
    ...over,
  };
}

function squareInvoice(over: Record<string, unknown>) {
  return {
    id: "sq-1",
    status: "UNPAID",
    payment_requests: [{ computed_amount_money: { amount: 10000, currency: "USD" } }],
    primary_recipient: {},
    ...over,
  };
}

beforeEach(() => {
  h.tables = { customers: [], documents: [] };
  h.ranges = [];
  h.updates = [];
  h.upserts = [];
  h.paid = [];
  h.invoices = [];
  h.payments = [];
});

describe("syncSquarePayments paging", () => {
  it("matches a document past the first 1000 rows", async () => {
    h.tables.documents = Array.from({ length: 1500 }, (_, i) => doc(i));
    // doc-1200 is INV-2201: only reachable on the second page.
    h.invoices = [squareInvoice({ id: "sq-late", status: "PAID", invoice_number: "INV-2201" })];

    const result = await syncSquarePayments();

    expect(result.error).toBeUndefined();
    expect(h.paid.map((p) => p.id)).toEqual(["doc-1200"]);
    const docPages = h.ranges.filter((r) => r.table === "documents");
    expect(docPages.map((r) => r.from)).toEqual([0, 1000, 1500]);
  });

  it("reads customers past the first 1000 rows", async () => {
    h.tables.customers = Array.from({ length: 1001 }, (_, i) => ({
      id: `cus-${i}`,
      name: `Person ${i}`,
      email: `p${i}@example.test`,
      phone: null,
      square_customer_id: null,
    }));
    h.invoices = [
      squareInvoice({ id: "sq-c", primary_recipient: { customer_id: "SQC", email_address: "p1000@example.test" } }),
    ];

    const result = await syncSquarePayments();

    expect(result.customersLinked).toBe(1);
    const linked = h.updates.find((u) => u.table === "customers");
    expect(linked?.filters).toEqual([["id", "cus-1000"]]);
  });
});

describe("syncSquarePayments never downgrades a paid document", () => {
  it("leaves a paid document alone when Square says UNPAID", async () => {
    h.tables.documents = [doc(0, { status: "paid", square_invoice_id: "sq-1", paid_at: "2026-11-01T15:00:00Z" })];
    h.invoices = [squareInvoice({ id: "sq-1", status: "UNPAID" })];

    const result = await syncSquarePayments();

    expect(h.updates.filter((u) => u.table === "documents" && "status" in u.patch)).toEqual([]);
    expect(h.paid).toEqual([]);
    expect(result.needsReview).toBeUndefined();
  });

  it("flags, but does not change, a paid document whose Square invoice was refunded", async () => {
    h.tables.documents = [doc(0, { status: "paid", square_invoice_id: "sq-1" })];
    h.invoices = [squareInvoice({ id: "sq-1", status: "REFUNDED" })];

    const result = await syncSquarePayments();

    expect(h.updates.filter((u) => u.table === "documents" && "status" in u.patch)).toEqual([]);
    expect(result.needsReview).toEqual(["INV-1001: Square invoice REFUNDED"]);
  });

  it("moves a draft to sent when Square has it outstanding", async () => {
    h.tables.documents = [doc(0, { status: "draft", square_invoice_id: "sq-1" })];
    h.invoices = [squareInvoice({ id: "sq-1", status: "UNPAID" })];

    await syncSquarePayments();

    const statusUpdates = h.updates.filter((u) => u.table === "documents" && "status" in u.patch);
    expect(statusUpdates).toEqual([
      { table: "documents", patch: { status: "sent" }, filters: [["id", "doc-0"], ["status", "draft"]] },
    ]);
  });

  it("does not link on amount alone", async () => {
    h.tables.documents = [doc(0, { doc_number: "INV-9999" })];
    h.invoices = [squareInvoice({ id: "sq-other", status: "PAID", invoice_number: "000123" })];

    await syncSquarePayments();

    expect(h.paid).toEqual([]);
    expect(h.updates.filter((u) => u.table === "documents")).toEqual([]);
  });
});
