import { describe, expect, it } from "vitest";
import {
  buildHistoryTasks,
  describeHistoryProgress,
  historyInvoiceRow,
  historyPaymentRow,
  historyRefundRow,
  newHistoryProgress,
  parseHistoryProgress,
} from "@/lib/square-history-map";

const NOW = "2026-11-11T15:00:00.000Z";

describe("buildHistoryTasks", () => {
  it("covers every location, invoices first, then payments and refunds by year from the oldest location", () => {
    const tasks = buildHistoryTasks(
      [
        { id: "L2", created_at: "2025-03-01T00:00:00Z" },
        { id: "L1", created_at: "2024-06-15T00:00:00Z" },
      ],
      NOW
    );
    expect(tasks.filter((t) => t.kind === "invoices").map((t) => t.locationId)).toEqual(["L1", "L2"]);
    const pay = tasks.filter((t) => t.kind === "payments");
    // 2024, 2025, 2026 for each of 2 locations
    expect(pay).toHaveLength(6);
    expect(pay[0]).toEqual({ kind: "payments", locationId: "L1", beginTime: "2024-01-01T00:00:00.000Z", endTime: "2025-01-01T00:00:00.000Z" });
    expect(pay[2].endTime).toBe(NOW);
    expect(tasks.filter((t) => t.kind === "refunds")).toHaveLength(6);
    expect(tasks.findIndex((t) => t.kind === "refunds")).toBeGreaterThan(tasks.findLastIndex((t) => t.kind === "payments"));
  });

  it("is the same list on every call, so an index is a safe resume point", () => {
    const locs = [{ id: "A", created_at: "2023-01-05T00:00:00Z" }, { id: "B" }];
    expect(buildHistoryTasks(locs, NOW)).toEqual(buildHistoryTasks([...locs].reverse(), NOW));
  });

  it("falls back to 2009 when Square gives no start date, and returns nothing with no locations", () => {
    const tasks = buildHistoryTasks([{ id: "A" }], NOW);
    expect(tasks.find((t) => t.kind === "payments")?.beginTime).toBe("2009-01-01T00:00:00.000Z");
    expect(buildHistoryTasks([], NOW)).toEqual([]);
    expect(buildHistoryTasks([{ name: "no id" }], NOW)).toEqual([]);
  });
});

describe("parseHistoryProgress", () => {
  it("accepts progress it made and rejects junk", () => {
    const p = { ...newHistoryProgress(true, NOW), taskIndex: 3, cursor: "abc", totalTasks: 10 };
    expect(parseHistoryProgress(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(parseHistoryProgress(null)).toBeNull();
    expect(parseHistoryProgress({ ...p, taskIndex: -1 })).toBeNull();
    expect(parseHistoryProgress({ ...p, taskIndex: 1.5 })).toBeNull();
    expect(parseHistoryProgress({ ...p, startedAt: "nope" })).toBeNull();
    expect(parseHistoryProgress({ ...p, cursor: 5 })).toBeNull();
    expect(parseHistoryProgress({ ...p, counts: { invoices: { found: 1 } } })).toBeNull();
  });
});

describe("historyInvoiceRow", () => {
  const invoice = {
    id: "inv1",
    status: "PAID",
    invoice_number: "000123",
    order_id: "ord1",
    created_at: "2022-05-01T12:00:00Z",
    updated_at: "2022-05-03T12:00:00Z",
    primary_recipient: { customer_id: "sqc1", given_name: "Pat", family_name: "Lee" },
    payment_requests: [{ computed_amount_money: { amount: 50000, currency: "USD" }, total_completed_amount_money: { amount: 50000 } }],
  };

  it("maps totals and never sets a document link", () => {
    const row = historyInvoiceRow(invoice, { crmCustomerId: "c1", now: NOW })!;
    expect(row).toMatchObject({
      square_invoice_id: "inv1",
      square_customer_id: "sqc1",
      total_cents: 50000,
      amount_paid_cents: 50000,
      amount_due_cents: 0,
      customer_id: "c1",
      square_customer_name: "Pat Lee",
      paid_at: "2022-05-03T12:00:00Z",
      synced_at: NOW,
    });
    expect("document_id" in row).toBe(false);
  });

  it("keeps the customer link and paid time the regular sync already set", () => {
    const row = historyInvoiceRow(invoice, {
      crmCustomerId: null,
      existing: { customer_id: "c9", paid_at: "2022-05-02T09:00:00Z" },
      now: NOW,
    })!;
    expect(row.customer_id).toBe("c9");
    expect(row.paid_at).toBe("2022-05-02T09:00:00Z");
  });

  it("skips a record with no id or status", () => {
    expect(historyInvoiceRow({ status: "PAID" }, { crmCustomerId: null, now: NOW })).toBeNull();
    expect(historyInvoiceRow({ id: "x" }, { crmCustomerId: null, now: NOW })).toBeNull();
  });
});

describe("historyPaymentRow", () => {
  it("maps money and card fields and keeps an existing invoice link", () => {
    const row = historyPaymentRow(
      {
        id: "pay1",
        status: "COMPLETED",
        customer_id: "sqc1",
        order_id: "ord1",
        amount_money: { amount: 10000, currency: "USD" },
        tip_money: { amount: 500 },
        total_money: { amount: 10500, currency: "USD" },
        source_type: "CARD",
        card_details: { card: { card_brand: "VISA", last_4: "4242" } },
        created_at: "2021-02-01T00:00:00Z",
      },
      { crmCustomerId: "c1", invoiceId: "inv-new", existing: { customer_id: null, square_invoice_id: "inv-old" }, now: NOW }
    )!;
    expect(row).toMatchObject({
      amount_cents: 10000,
      tip_cents: 500,
      total_cents: 10500,
      card_brand: "VISA",
      card_last4: "4242",
      customer_id: "c1",
      square_invoice_id: "inv-old",
    });
  });
});

describe("historyRefundRow", () => {
  it("takes the customer from the refunded payment and adds up fees", () => {
    const row = historyRefundRow(
      {
        id: "ref1",
        status: "COMPLETED",
        payment_id: "pay1",
        location_id: "L1",
        reason: "Duplicate charge",
        amount_money: { amount: 2500, currency: "USD" },
        processing_fee: [{ amount_money: { amount: -30 } }, { amount_money: { amount: -10 } }],
        created_at: "2023-03-01T00:00:00Z",
      },
      { payment: { square_customer_id: "sqc1", customer_id: "c1" }, now: NOW }
    )!;
    expect(row).toMatchObject({
      square_refund_id: "ref1",
      square_payment_id: "pay1",
      square_customer_id: "sqc1",
      customer_id: "c1",
      amount_cents: 2500,
      processing_fee_cents: -40,
      reason: "Duplicate charge",
    });
  });

  it("leaves the customer empty when the payment isn't in the CRM", () => {
    const row = historyRefundRow({ id: "ref2", status: "PENDING" }, { now: NOW })!;
    expect(row.customer_id).toBeNull();
    expect(row.amount_cents).toBe(0);
  });
});

describe("describeHistoryProgress", () => {
  it("says new for a preview and added for an import", () => {
    const p = newHistoryProgress(true, NOW);
    p.counts.invoices = { found: 3, isNew: 1 };
    expect(describeHistoryProgress(p)).toBe("3 invoices (1 new), 0 payments (0 new), 0 refunds (0 new)");
    expect(describeHistoryProgress({ ...p, dryRun: false })).toContain("3 invoices (1 added)");
  });
});
