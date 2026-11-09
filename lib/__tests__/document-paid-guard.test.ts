import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { op: "select" | "update"; values?: Record<string, unknown>; filters: unknown[][] };

const h = vi.hoisted(() => ({
  existing: null as Record<string, unknown> | null,
  // Rows each update returns, in order (an update that matched nothing returns []).
  updateRows: [] as unknown[][],
  updateError: null as { message: string } | null,
  calls: [] as Call[],
  markPaid: vi.fn(),
  emailSent: vi.fn(),
}));

vi.mock("@/lib/require-role", () => ({ requireOffice: () => Promise.resolve() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/pdf", () => ({ renderDocumentPdf: () => Promise.resolve(Buffer.from("pdf")) }));
vi.mock("@/lib/assessment-reports", () => ({ getAssessmentReportForPdf: vi.fn() }));
vi.mock("@/lib/assessment-report-pdf", () => ({ renderAssessmentReportPdf: vi.fn() }));
vi.mock("@/lib/warranty-reports", () => ({ getWarrantyReportForPdf: vi.fn() }));
vi.mock("@/lib/warranty-report-pdf", () => ({ renderWarrantyReportPdf: vi.fn() }));
vi.mock("@/lib/contract-reports", () => ({ getContractForPdf: vi.fn() }));
vi.mock("@/lib/contract-pdf", () => ({ renderContractPdf: vi.fn() }));
vi.mock("@/lib/pm/send", () => ({ sendPmReportToCustomer: vi.fn() }));
vi.mock("@/lib/payment-links", () => ({ createInvoicePaymentLink: vi.fn() }));
vi.mock("@/lib/resend", () => ({
  RESEND_FROM_EMAIL: "from@example.test",
  RESEND_REPLY_TO: "reply@example.test",
  resend: {
    emails: {
      send: (...a: unknown[]) => {
        h.emailSent(...a);
        return Promise.resolve({ error: null });
      },
    },
  },
}));
vi.mock("@/lib/documents", () => ({
  dueDateForSend: () => "2026-12-01",
  getDocumentForPdf: () =>
    Promise.resolve({
      data: { type: "invoice", doc_number: "INV-1", customer_name: "Pat", totals: { better: 100 }, pricing_mode: "flat" },
      customerEmail: "pat@example.test",
      dueDate: null,
      error: null,
    }),
}));
vi.mock("@/lib/document-paid", () => ({
  markDocumentPaid: (...a: unknown[]) => {
    h.markPaid(...a);
    return Promise.resolve({ updated: true });
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      const call: Call = { op: "select", filters: [] };
      const b: Record<string, unknown> = {
        select: () => b,
        update: (values: Record<string, unknown>) => {
          call.op = "update";
          call.values = values;
          return b;
        },
        single: () => Promise.resolve({ data: h.existing, error: null }),
        maybeSingle: () => Promise.resolve({ data: h.existing, error: null }),
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
          h.calls.push(call);
          const result =
            call.op === "update" ? { data: h.updateRows.shift() ?? [{ id: "d1" }], error: h.updateError } : { data: null, error: null };
          return Promise.resolve(result).then(res, rej);
        },
      };
      for (const m of ["eq", "or", "is"]) {
        b[m] = (...args: unknown[]) => {
          call.filters.push([m, ...args]);
          return b;
        };
      }
      return b;
    },
  },
}));

import { sendDocumentEmail, updateDocument } from "@/app/(internal)/documents/[id]/actions";

function form(status: string) {
  const f = new FormData();
  f.set("id", "d1");
  f.set("status", status);
  f.set("pricing_mode", "flat");
  f.set("item_count", "1");
  f.set("description_0", "Service call");
  f.set("qty_0", "1");
  f.set("better_0", "100");
  return f;
}

const updates = () => h.calls.filter((c) => c.op === "update");
const NOT_PAID = ["or", "status.is.null,status.neq.paid"];

beforeEach(() => {
  h.existing = { type: "invoice", status: "sent", line_items: { items: [] }, due_date: null, selected_tier: null };
  h.updateRows = [];
  h.updateError = null;
  h.calls = [];
  h.markPaid.mockClear();
  h.emailSent.mockClear();
});

describe("updateDocument never un-pays a document", () => {
  it("refuses a stale Draft/Sent save on a document that is paid now", async () => {
    h.existing = { ...h.existing, status: "paid" };
    for (const status of ["draft", "sent", "approved"]) {
      expect(await updateDocument(null, form(status))).toEqual({
        error: "This document was paid since you opened it. Reload the page.",
      });
    }
    expect(updates()).toEqual([]);
  });

  it("only writes a status to a row that is still not paid", async () => {
    expect(await updateDocument(null, form("sent"))).toEqual({ saved: true });
    const [u] = updates();
    expect(u.values?.status).toBe("sent");
    expect(u.filters).toContainEqual(NOT_PAID);
  });

  it("says so when the payment landed between the read and the write", async () => {
    h.updateRows = [[]];
    expect(await updateDocument(null, form("sent"))).toEqual({
      error: "This document was paid since you opened it. Reload the page.",
    });
  });

  it("still saves line items on a paid document when the status stays Paid", async () => {
    h.existing = { ...h.existing, status: "paid" };
    expect(await updateDocument(null, form("paid"))).toEqual({ saved: true });
    const [u] = updates();
    expect(u.values?.status).toBeUndefined();
    expect(u.filters).not.toContainEqual(NOT_PAID);
    expect(h.markPaid).toHaveBeenCalledWith("d1", { source: "manual" });
  });
});

describe("sendDocumentEmail never un-pays a document", () => {
  function sendForm() {
    const f = new FormData();
    f.set("id", "d1");
    return f;
  }

  it("marks an unpaid document sent", async () => {
    expect(await sendDocumentEmail(null, sendForm())).toEqual({ sent: true });
    const [u] = updates();
    expect(u.values).toMatchObject({ status: "sent" });
    expect(u.filters).toContainEqual(NOT_PAID);
    expect(updates()).toHaveLength(1);
  });

  it("re-emailing a paid invoice keeps it paid and still stamps sent_at", async () => {
    h.updateRows = [[]]; // the status write matched nothing: it is paid
    expect(await sendDocumentEmail(null, sendForm())).toEqual({ sent: true });
    expect(h.emailSent).toHaveBeenCalledTimes(1);
    const [, second] = updates();
    expect(second.values).not.toHaveProperty("status");
    expect(second.values).toHaveProperty("sent_at");
  });
});
