import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Call, Handler } from "./fake-supabase";

const h = vi.hoisted(() => ({
  handler: (() => ({})) as Handler,
  calls: [] as Call[],
  role: "office" as string | null,
  createInvoice: vi.fn(),
  createError: null as Error | null,
}));

vi.mock("@/lib/supabase", async () => {
  const { fakeSupabase } = await import("./fake-supabase");
  const fake = fakeSupabase((call) => {
    h.calls.push(call);
    return h.handler(call);
  });
  return { supabase: fake.client };
});
vi.mock("@/lib/require-role", () => ({ getStaffRole: () => Promise.resolve(h.role) }));
vi.mock("@/lib/document-generation", () => ({
  createInvoiceDirect: (input: Record<string, unknown>) => {
    h.createInvoice(input);
    if (h.createError) return Promise.reject(h.createError);
    const items = input.items as { unit_price: number; qty: number }[];
    const total = items.reduce((s, i) => s + i.unit_price * i.qty, 0);
    return Promise.resolve({ documentId: "inv-new", docNumber: "INV-2001", total });
  },
}));

import { ensureFinishInvoice, getInvoicePrompt, makeRoomForReportInvoice } from "../finish-invoice";
import { has, payload } from "./fake-supabase";

type Doc = Record<string, unknown>;

/** jobs row, the job's invoices (documents queried with or()), and the linked contract/estimate. */
function db(t: { job?: Doc | null; invoices?: Doc[]; linked?: Doc | null; voided?: boolean }) {
  const invoices = t.invoices ?? [];
  h.handler = (call) => {
    if (call.table === "jobs") return { data: t.job === undefined ? JOB : t.job };
    if (call.table === "documents" && payload(call, "update")) return { data: t.voided ? [{ id: "x" }] : [] };
    if (call.table === "documents" && has(call, "or")) return { data: invoices };
    if (call.table === "documents") return { data: t.linked ?? null };
    return {};
  };
  // Each draft made lands in the table, so a second Finish sees it.
  h.createInvoice.mockImplementation((input: Record<string, unknown>) => {
    if (!h.createError) invoices.push({ id: "inv-new", doc_number: "INV-2001", status: "draft", total: 0, sent_at: null, input });
  });
}

const JOB = { id: "j1", customer_id: "c1", property_id: "p1", document_id: "d1" };
const CONTRACT = { doc_number: "C-1001", type: "contract", status: "signed", total: 10000, deposit_received_cents: 500000 };

beforeEach(() => {
  h.calls = [];
  h.role = "office";
  h.createError = null;
  h.createInvoice.mockReset();
});

describe("ensureFinishInvoice (runs when a job becomes complete)", () => {
  it("makes one draft balance invoice when the job has none: contract total less deposit", async () => {
    db({ linked: CONTRACT });
    const out = await ensureFinishInvoice("j1");
    expect(h.createInvoice).toHaveBeenCalledTimes(1);
    const input = h.createInvoice.mock.calls[0][0];
    expect(input).toMatchObject({ customerId: "c1", propertyId: "p1", jobId: "j1", extra: { balance_for_job_id: "j1" } });
    expect(input.items).toHaveLength(1);
    expect(input.items[0].unit_price).toBe(5000);
    expect(input.items[0].description).toBe("Balance due on contract C-1001");
    expect(out).toMatchObject({ kind: "created", priced: true, invoice: { id: "inv-new", doc_number: "INV-2001", status: "draft" } });
  });

  it("makes nothing when the job already has a live invoice (balance, service report, or linked)", async () => {
    db({ linked: CONTRACT, invoices: [{ id: "inv0", doc_number: "INV-1500", status: "sent", total: 300, sent_at: "2026-11-01" }] });
    const out = await ensureFinishInvoice("j1");
    expect(h.createInvoice).not.toHaveBeenCalled();
    expect(out).toEqual({ kind: "exists", invoice: expect.objectContaining({ id: "inv0" }) });
  });

  it("looks for the job's invoice by job_id, balance_for_job_id and the job's own document", async () => {
    db({ linked: CONTRACT, invoices: [{ id: "inv0", doc_number: "INV-1", status: "draft", total: 1, sent_at: null }] });
    await ensureFinishInvoice("j1");
    const lookup = h.calls.find((c) => c.table === "documents" && has(c, "or"));
    expect(lookup?.ops).toContainEqual(["or", "job_id.eq.j1,balance_for_job_id.eq.j1,id.eq.d1"]);
    expect(lookup && has(lookup, "eq", "type", "invoice")).toBe(true);
  });

  it("a voided invoice does not count, so a new draft is made", async () => {
    db({ linked: CONTRACT, invoices: [{ id: "old", doc_number: "INV-1", status: "void", total: 5000, sent_at: null }] });
    expect((await ensureFinishInvoice("j1")).kind).toBe("created");
    expect(h.createInvoice).toHaveBeenCalledTimes(1);
  });

  it("with no price on file the draft has no lines at all, never a guessed amount", async () => {
    db({ job: { ...JOB, document_id: null } });
    const out = await ensureFinishInvoice("j1");
    const input = h.createInvoice.mock.calls[0][0];
    expect(input.items).toEqual([]);
    expect(input.allowNoItems).toBe(true);
    expect(out).toMatchObject({ kind: "created", priced: false });
  });

  it("a deposit that covers the whole total: no draft, and the alert says why (not 'no price')", async () => {
    db({ linked: { ...CONTRACT, deposit_received_cents: 1000000 } });
    const out = await ensureFinishInvoice("j1");
    expect(h.createInvoice).not.toHaveBeenCalled();
    expect(out).toEqual({ kind: "none", reason: expect.stringMatching(/deposit received covers the full total/) });
  });

  it("an estimate the customer has not approved gives no price", async () => {
    db({ linked: { doc_number: "E-1", type: "estimate", status: "sent", total: 900, deposit_received_cents: null } });
    await ensureFinishInvoice("j1");
    expect(h.createInvoice.mock.calls[0][0].items).toEqual([]);
  });

  it("double Finish: the second call finds the first draft and makes nothing", async () => {
    db({ linked: CONTRACT });
    await ensureFinishInvoice("j1");
    const second = await ensureFinishInvoice("j1");
    expect(h.createInvoice).toHaveBeenCalledTimes(1);
    expect(second.kind).toBe("exists");
  });

  it("a race lost at the database's one-balance-invoice index is 'already exists', not an error", async () => {
    const invoices: Doc[] = [];
    db({ linked: CONTRACT, invoices });
    h.createError = new Error('duplicate key value violates unique constraint "documents_one_balance_invoice_per_job_idx"');
    // The other Finish's draft is there by the time we look again.
    h.createInvoice.mockImplementation(() => invoices.push({ id: "other", doc_number: "INV-2002", status: "draft", total: 5000, sent_at: null }));
    const out = await ensureFinishInvoice("j1");
    expect(out).toEqual({ kind: "exists", invoice: expect.objectContaining({ id: "other" }) });
  });

  it("a job with no customer gets no invoice and says why", async () => {
    db({ job: { ...JOB, customer_id: null } });
    const out = await ensureFinishInvoice("j1");
    expect(h.createInvoice).not.toHaveBeenCalled();
    expect(out.kind).toBe("none");
  });

  it("never throws: a database failure comes back as 'none'", async () => {
    h.handler = (call) => (call.table === "documents" ? { error: { message: "down" } } : { data: JOB });
    await expect(ensureFinishInvoice("j1")).resolves.toMatchObject({ kind: "none" });
  });

  it("never sends: it makes a draft and that is all", async () => {
    db({ linked: CONTRACT });
    await ensureFinishInvoice("j1");
    expect(h.calls.some((c) => c.ops.some(([m, v]) => m === "update" && (v as Doc)?.status === "sent"))).toBe(false);
  });
});

describe("getInvoicePrompt (the Send now / Open panel after Finish)", () => {
  it("owner and office get the draft with its number and amount", async () => {
    for (const role of ["owner", "office"]) {
      h.role = role;
      db({ invoices: [{ id: "inv1", doc_number: "INV-1001", status: "draft", total: 5000, sent_at: null }] });
      expect(await getInvoicePrompt("j1")).toEqual({ id: "inv1", docNumber: "INV-1001", totalCents: 500000, priced: true });
    }
  });

  it("a tech gets nothing, and the money tables are never read", async () => {
    h.role = "tech";
    db({ invoices: [{ id: "inv1", doc_number: "INV-1001", status: "draft", total: 5000, sent_at: null }] });
    expect(await getInvoicePrompt("j1")).toBeNull();
    expect(h.calls).toEqual([]);
  });

  it("no prompt once the invoice is sent or paid", async () => {
    db({ invoices: [{ id: "inv1", doc_number: "INV-1001", status: "sent", total: 5000, sent_at: "2026-11-09" }] });
    expect(await getInvoicePrompt("j1")).toBeNull();
    db({ invoices: [{ id: "inv1", doc_number: "INV-1001", status: "paid", total: 5000, sent_at: null }] });
    expect(await getInvoicePrompt("j1")).toBeNull();
  });

  it("a draft with no lines is offered as Open only (priced false)", async () => {
    db({ invoices: [{ id: "inv1", doc_number: "INV-1001", status: "draft", total: 0, sent_at: null }] });
    expect(await getInvoicePrompt("j1")).toMatchObject({ priced: false, totalCents: 0 });
  });
});

describe("makeRoomForReportInvoice (service report invoice after Finish)", () => {
  it("no invoice on the job: go ahead", async () => {
    db({});
    expect(await makeRoomForReportInvoice("j1")).toEqual({});
  });

  it("voids the empty Finish draft so the report invoice replaces it", async () => {
    db({ invoices: [{ id: "d0", doc_number: "INV-9", status: "draft", total: 0, sent_at: null }], voided: true });
    expect(await makeRoomForReportInvoice("j1")).toEqual({});
    const voidCall = h.calls.find((c) => c.table === "documents" && payload(c, "update"));
    expect(payload(voidCall!, "update")).toEqual({ status: "void" });
    const filters = [
      ["eq", "id", "d0"],
      ["eq", "balance_for_job_id", "j1"],
      ["eq", "status", "draft"],
      ["is", "sent_at", null],
      ["eq", "total", 0],
    ];
    for (const f of filters) expect(voidCall!.ops).toContainEqual(f);
  });

  it("refuses when the job already has a priced or sent invoice", async () => {
    db({ invoices: [{ id: "d0", doc_number: "INV-9", status: "draft", total: 5000, sent_at: null }] });
    expect((await makeRoomForReportInvoice("j1")).error).toMatch(/already has invoice INV-9/);
    expect(h.calls.some((c) => payload(c, "update"))).toBe(false);
  });

  it("a report with no job is not limited", async () => {
    expect(await makeRoomForReportInvoice(null)).toEqual({});
  });
});
