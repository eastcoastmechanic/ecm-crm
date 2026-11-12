import { describe, expect, it, vi } from "vitest";
import {
  buildInvoiceView,
  depositNote,
  depositSentence,
  invoiceForSend,
  invoiceIssueDate,
  isPastDue,
  jobReference,
  type InvoiceExtras,
} from "@/lib/invoice-view";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/lib/job-photos", () => ({ customerFacingJobPhotos: vi.fn(), jobIdForDocument: vi.fn() }));
const { dueDateForSend } = await import("@/lib/documents");

const line = (better: number | null, qty = 1, extra: Partial<{ unit: string; notes: string | null; category: string }> = {}) => ({
  description: "Work",
  category: extra.category ?? "Labor",
  notes: extra.notes ?? null,
  qty,
  unit: extra.unit ?? "ea",
  better,
});

describe("buildInvoiceView", () => {
  it("adds up qty x unit price per line and bills documents.total", () => {
    const v = buildInvoiceView({ lines: [line(125, 2), line(12.5, 3)], total: 287.5, status: "sent" });
    expect(v.lines.map((l) => l.amountCents)).toEqual([25000, 3750]);
    expect(v.subtotalCents).toBe(28750);
    expect(v.totalCents).toBe(28750);
    expect(v.balanceDueCents).toBe(28750);
    expect(v.paid).toBe(false);
  });

  it("the balance due is documents.total (what Stripe charges), even if a stored line disagrees", () => {
    const v = buildInvoiceView({ lines: [line(100)], total: "90.00", status: "sent" });
    expect(v.subtotalCents).toBe(10000);
    expect(v.balanceDueCents).toBe(9000);
  });

  it("falls back to subtotal plus tax when the row has no total", () => {
    const v = buildInvoiceView({ lines: [line(100)], total: null, tax: 6.25, status: "draft" });
    expect(v.taxCents).toBe(625);
    expect(v.totalCents).toBe(10625);
  });

  it("a paid invoice owes nothing", () => {
    const v = buildInvoiceView({ lines: [line(100)], total: 100, status: "paid" });
    expect(v.paid).toBe(true);
    expect(v.balanceDueCents).toBe(0);
    expect(v.totalCents).toBe(10000);
  });

  it("no floating point drift on cents", () => {
    const v = buildInvoiceView({ lines: [line(0.1, 3), line(0.2, 1)], total: 0.5, status: "sent" });
    expect(v.subtotalCents).toBe(50);
  });

  it("an unpriced line shows a dash, not $0", () => {
    const v = buildInvoiceView({ lines: [line(null)], total: 0, status: "draft" });
    expect(v.lines[0].amountCents).toBeNull();
    expect(v.lines[0].unitCents).toBeNull();
  });

  it("drops 'ea' from the quantity and joins category and notes", () => {
    const v = buildInvoiceView({
      lines: [line(10, 2), line(10, 3, { unit: "ft", notes: "Lineset", category: "Parts" })],
      total: 50,
      status: "sent",
    });
    expect(v.lines[0].qtyLabel).toBe("2");
    expect(v.lines[1].qtyLabel).toBe("3 ft");
    expect(v.lines[1].detail).toBe("Parts · Lineset");
  });
});

describe("depositNote", () => {
  const contract = { doc_number: "CON-1", type: "contract", status: "signed", total: 9000, deposit_received_cents: 450000 };

  it("notes the deposit on a contract and says it's taken off only when the numbers match", () => {
    expect(depositNote(contract, 450000)).toEqual({
      word: "Contract",
      docNumber: "CON-1",
      docTotalCents: 900000,
      depositCents: 450000,
      takenOff: true,
    });
    expect(depositNote(contract, 460000)?.takenOff).toBe(false);
  });

  it("nothing without a deposit, on an unapproved estimate, or with no linked document", () => {
    expect(depositNote({ ...contract, deposit_received_cents: null }, 0)).toBeNull();
    expect(depositNote({ ...contract, deposit_received_cents: 0 }, 0)).toBeNull();
    expect(depositNote({ ...contract, type: "estimate", status: "sent" }, 450000)).toBeNull();
    expect(depositNote(null, 0)).toBeNull();
  });

  it("an approved estimate's deposit counts", () => {
    expect(depositNote({ ...contract, type: "estimate", status: "approved" }, 450000)?.word).toBe("Estimate");
  });

  it("never subtracts the deposit again from the balance", () => {
    const v = buildInvoiceView({ lines: [line(4500)], total: 4500, status: "sent", linked: contract });
    expect(v.balanceDueCents).toBe(450000);
    expect(depositSentence(v.deposit!)).toBe(
      "Contract CON-1 total $9,000.00. Deposit received $4,500.00, already taken off this invoice."
    );
  });
});

describe("dates", () => {
  it("past due only when owing and the New York date is after the due date", () => {
    const owing = { paid: false, balanceDueCents: 100 };
    expect(isPastDue(owing, "2026-11-10", "2026-11-11")).toBe(true);
    expect(isPastDue(owing, "2026-11-11", "2026-11-11")).toBe(false);
    expect(isPastDue(owing, null, "2026-11-11")).toBe(false);
    expect(isPastDue({ paid: true, balanceDueCents: 0 }, "2026-11-01", "2026-11-11")).toBe(false);
  });

  it("issue date: first send, else now when sending, else created", () => {
    const now = new Date("2026-11-11T15:00:00Z");
    expect(invoiceIssueDate("2026-11-01T12:00:00Z", "2026-10-30T12:00:00Z", now)).toBe("2026-11-01T12:00:00Z");
    expect(invoiceIssueDate(null, "2026-10-30T12:00:00Z", now)).toBe(now.toISOString());
    expect(invoiceIssueDate(null, "2026-10-30T12:00:00Z")).toBe("2026-10-30T12:00:00Z");
  });

  it("net 30 counts from the New York date, so a 10 PM ET send isn't a day late", () => {
    // 10 PM ET on Nov 10 is already Nov 11 in UTC.
    expect(dueDateForSend("invoice", null, new Date("2026-11-11T03:00:00Z"))).toBe("2026-12-10");
    expect(dueDateForSend("invoice", "2026-12-01")).toBeUndefined();
    expect(dueDateForSend("estimate", null)).toBeUndefined();
  });

  it("invoiceForSend keeps a stored due date and fills a new one on first send", () => {
    const base = { sentAt: null, createdAt: "2026-11-01T12:00:00Z", dueDate: null } as unknown as InvoiceExtras;
    const now = new Date("2026-11-11T15:00:00Z");
    expect(invoiceForSend(base, "2026-12-11", now)).toMatchObject({ dueDate: "2026-12-11", issueDate: now.toISOString() });
    expect(invoiceForSend({ ...base, dueDate: "2026-12-01" }, undefined, now).dueDate).toBe("2026-12-01");
  });

  it("job reference reads plainly", () => {
    const fmt = (iso: string) => iso.slice(0, 10);
    expect(jobReference(null, fmt)).toBeNull();
    expect(jobReference({ job_type: "service", completed_at: "2026-11-09T20:00:00Z", scheduled_at: null }, fmt)).toBe(
      "Service call, completed 2026-11-09"
    );
    expect(jobReference({ job_type: "odd", completed_at: null, scheduled_at: null }, fmt)).toBe("Job");
  });
});
