import { describe, expect, it } from "vitest";
import {
  balanceDueCents,
  balanceLineFor,
  centsToDollars,
  finishInvoiceAlertLine,
  formatMoney,
  parseMoneyToCents,
} from "../job-invoice-rules";

describe("parseMoneyToCents", () => {
  it("reads plain and formatted amounts", () => {
    expect(parseMoneyToCents("1234.5")).toBe(123450);
    expect(parseMoneyToCents("$1,234.50")).toBe(123450);
    expect(parseMoneyToCents(" 0 ")).toBe(0);
  });
  it("rejects blanks, junk and negatives", () => {
    expect(parseMoneyToCents("")).toBeNull();
    expect(parseMoneyToCents("abc")).toBeNull();
    expect(parseMoneyToCents("-5")).toBeNull();
  });
  it("rounds to the cent", () => {
    expect(parseMoneyToCents("10.005")).toBe(1001);
  });
});

describe("balanceDueCents", () => {
  it("is total minus deposit received", () => {
    expect(balanceDueCents(1000000, 333300)).toBe(666700);
  });
  it("treats an unknown deposit as nothing received", () => {
    expect(balanceDueCents(500000, null)).toBe(500000);
  });
  it("never goes negative", () => {
    expect(balanceDueCents(100000, 150000)).toBe(0);
  });
});

describe("money formatting", () => {
  it("formats cents", () => {
    expect(formatMoney(666700)).toBe("$6,667.00");
    expect(centsToDollars(666700)).toBe(6667);
  });
});

describe("balanceLineFor", () => {
  it("contract: total less deposit received", () => {
    expect(balanceLineFor({ doc_number: "C-1", type: "contract", total: 10000, deposit_received_cents: 500000 })).toEqual({
      description: "Balance due on contract C-1",
      notes: "Contract total $10,000.00, deposit received $5,000.00",
      cents: 500000,
    });
  });
  it("an approved estimate prices it; any other estimate does not", () => {
    expect(
      balanceLineFor({ doc_number: "E-1", type: "estimate", status: "approved", total: "800", deposit_received_cents: null }).cents
    ).toBe(80000);
    expect(
      balanceLineFor({ doc_number: "E-1", type: "estimate", status: "sent", total: 800, deposit_received_cents: null }).cents
    ).toBeNull();
  });
  it("nothing linked, or no total: no price, never a guess", () => {
    expect(balanceLineFor(null)).toEqual({ description: "Balance due for completed work", notes: null, cents: null });
    expect(balanceLineFor({ doc_number: "C-2", type: "contract", total: null, deposit_received_cents: null }).cents).toBeNull();
  });
});

describe("finishInvoiceAlertLine", () => {
  const inv = { id: "i", doc_number: "INV-7", status: "draft", total: 10, sent_at: null };
  it("names the draft or the invoice that was already there", () => {
    expect(finishInvoiceAlertLine({ kind: "created", priced: true, invoice: inv })).toBe("Draft invoice INV-7 ready to review and send.");
    expect(finishInvoiceAlertLine({ kind: "created", priced: false, invoice: inv })).toMatch(/Add line items/);
    expect(finishInvoiceAlertLine({ kind: "exists", invoice: inv })).toBe("Invoice INV-7 already exists, not sent yet.");
    expect(finishInvoiceAlertLine({ kind: "exists", invoice: { ...inv, status: "sent", sent_at: "x" } })).toBe(
      "Invoice INV-7 already sent."
    );
    expect(finishInvoiceAlertLine({ kind: "exists", invoice: { ...inv, status: "paid" } })).toBe("Invoice INV-7 already paid.");
    expect(finishInvoiceAlertLine({ kind: "none", reason: "the job has no customer." })).toBe(
      "No invoice made: the job has no customer."
    );
  });
});
