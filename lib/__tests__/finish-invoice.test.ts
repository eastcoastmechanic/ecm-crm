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
  directInvoiceContent: (items: { unit_price: number; qty: number }[]) => {
    const total = Math.round(items.reduce((s, i) => s + i.unit_price * i.qty, 0) * 100) / 100;
    return { total, line_items: { items } };
  },
  createInvoiceDirect: (input: Record<string, unknown>) => {
    h.createInvoice(input);
    if (h.createError) return Promise.reject(h.createError);
    const items = input.items as { unit_price: number; qty: number }[];
    const total = items.reduce((s, i) => s + i.unit_price * i.qty, 0);
    return Promise.resolve({ documentId: "inv-new", docNumber: "INV-2001", total });
  },
}));

import { ensureFinishInvoice, getInvoicePrompt, makeRoomForReportInvoice, recalculateJobDraft } from "../finish-invoice";
import { has, payload } from "./fake-supabase";

type Doc = Record<string, unknown>;

/** jobs row, the job's invoices (documents queried with or()), and the linked contract/estimate. */
function db(t: { job?: Doc | null; invoices?: Doc[]; linked?: Doc | null; voided?: boolean; entries?: Doc[]; receipts?: Doc[]; updated?: boolean }) {
  const invoices = t.invoices ?? [];
  h.handler = (call) => {
    if (call.table === "jobs") return { data: t.job === undefined ? JOB : t.job };
    if (call.table === "job_time_entries") return { data: t.entries ?? [] };
    if (call.table === "job_receipts") return { data: t.receipts ?? [] };
    if (call.table === "documents" && payload(call, "update") && t.updated !== undefined) return { data: t.updated ? [{ id: "x" }] : [] };
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

  it("with no price on file and nothing clocked or bought, the draft is just the work line at $0, never a guess", async () => {
    db({ job: { ...JOB, document_id: null } });
    const out = await ensureFinishInvoice("j1");
    const input = h.createInvoice.mock.calls[0][0];
    expect(input.items).toHaveLength(1);
    expect(input.items[0]).toMatchObject({ category: "Work performed", unit_price: 0 });
    expect(input.extra).toEqual({ balance_for_job_id: "j1" });
    expect(out).toMatchObject({ kind: "created", priced: false });
  });

  it("with no price on file, the draft bills clocked labor and receipts with markup", async () => {
    process.env.HOURLY_LABOR_RATE = "125";
    delete process.env.MATERIALS_MARKUP_PERCENT;
    db({
      job: { ...JOB, document_id: null },
      entries: [
        { kind: "work", started_at: "2026-11-13T14:00:00Z", ended_at: "2026-11-13T16:10:00Z", voided_at: null },
        { kind: "work", started_at: "2026-11-13T10:00:00Z", ended_at: "2026-11-13T12:00:00Z", voided_at: "2026-11-13T18:00:00Z" },
      ],
      receipts: [{ vendor: "Supply House", note: null, amount_cents: 10000 }],
    });
    const out = await ensureFinishInvoice("j1");
    const items = h.createInvoice.mock.calls[0][0].items as { category: string; qty: number; unit_price: number }[];
    expect(items.map((i) => i.category)).toEqual(["Work performed", "Labor", "Materials"]);
    expect(items[1]).toMatchObject({ qty: 2.25, unit_price: 125 });
    expect(items[2]).toMatchObject({ qty: 1, unit_price: 135 });
    expect(out).toMatchObject({ kind: "created", priced: true });
  });

  it("a linked contract keeps the balance line even when the job has clocked time and receipts", async () => {
    db({
      linked: CONTRACT,
      entries: [{ kind: "work", started_at: "2026-11-13T14:00:00Z", ended_at: "2026-11-13T16:00:00Z" }],
      receipts: [{ vendor: "X", note: null, amount_cents: 500 }],
    });
    await ensureFinishInvoice("j1");
    const items = h.createInvoice.mock.calls[0][0].items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ category: "Contract balance", unit_price: 5000 });
  });

  it("a deposit that covers the whole total: no draft, and the alert says why (not 'no price')", async () => {
    db({ linked: { ...CONTRACT, deposit_received_cents: 1000000 } });
    const out = await ensureFinishInvoice("j1");
    expect(h.createInvoice).not.toHaveBeenCalled();
    expect(out).toEqual({ kind: "none", reason: expect.stringMatching(/deposit received covers the full total/) });
  });

  it("an estimate the customer has not approved gives no price, so the draft is built from the job", async () => {
    db({ linked: { doc_number: "E-1", type: "estimate", status: "sent", total: 900, deposit_received_cents: null } });
    await ensureFinishInvoice("j1");
    const items = h.createInvoice.mock.calls[0][0].items;
    expect(items.map((i: { category: string }) => i.category)).toEqual(["Work performed"]);
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

  it("voids Finish's own labor-and-receipts draft (never sent) so the report invoice replaces it", async () => {
    db({
      invoices: [
        {
          id: "d1",
          doc_number: "INV-9",
          status: "draft",
          total: 400,
          sent_at: null,
          balance_for_job_id: "j1",
          line_items: { items: [{ category: "Work performed" }, { category: "Labor" }] },
        },
      ],
      voided: true,
    });
    expect(await makeRoomForReportInvoice("j1")).toEqual({});
    const voidCall = h.calls.find((c) => c.table === "documents" && payload(c, "update"));
    expect(voidCall!.ops).toContainEqual(["eq", "status", "draft"]);
    expect(voidCall!.ops).toContainEqual(["is", "sent_at", null]);
  });

  it("does not void a priced draft that was edited into other lines", async () => {
    db({
      invoices: [
        {
          id: "d1",
          doc_number: "INV-9",
          status: "draft",
          total: 400,
          sent_at: null,
          balance_for_job_id: "j1",
          line_items: { items: [{ category: "Labor" }, { category: "Parts" }] },
        },
      ],
    });
    expect((await makeRoomForReportInvoice("j1")).error).toMatch(/already has invoice INV-9/);
  });

  it("a report with no job is not limited", async () => {
    expect(await makeRoomForReportInvoice(null)).toEqual({});
  });
});

describe("recalculateJobDraft (office Recalculate draft)", () => {
  const BUILT = {
    id: "d1",
    doc_number: "INV-9",
    status: "draft",
    total: 0,
    sent_at: null,
    balance_for_job_id: "j1",
    line_items: { items: [{ category: "Work performed" }] },
  };

  it("rebuilds the draft from labor and receipts, only while it is an unsent draft", async () => {
    process.env.HOURLY_LABOR_RATE = "125";
    process.env.MATERIALS_MARKUP_PERCENT = "35";
    db({
      job: { ...JOB, document_id: null },
      invoices: [BUILT],
      entries: [{ kind: "work", started_at: "2026-11-13T14:00:00Z", ended_at: "2026-11-13T15:00:00Z" }],
      receipts: [{ vendor: "Supply", note: null, amount_cents: 1999 }],
      updated: true,
    });
    const out = await recalculateJobDraft("j1");
    // 1 hr x 125, plus 19.99 x 1.35 = 26.9865, which rounds to 26.99
    expect(out).toEqual({ total: 151.99, warnings: [] });
    const update = h.calls.find((c) => c.table === "documents" && payload(c, "update"));
    expect(payload(update!, "update")).toMatchObject({ total: 151.99, subtotal: 151.99 });
    for (const f of [
      ["eq", "id", "d1"],
      ["eq", "balance_for_job_id", "j1"],
      ["eq", "status", "draft"],
      ["is", "sent_at", null],
    ]) {
      expect(update!.ops).toContainEqual(f);
    }
  });

  it("never touches a sent or paid invoice", async () => {
    for (const inv of [{ ...BUILT, status: "sent", sent_at: "2026-11-13" }, { ...BUILT, status: "paid" }]) {
      h.calls = [];
      db({ job: { ...JOB, document_id: null }, invoices: [inv] });
      expect(await recalculateJobDraft("j1")).toMatchObject({ error: expect.stringMatching(/recalculated/) });
      expect(h.calls.some((c) => payload(c, "update"))).toBe(false);
    }
  });

  it("leaves a service-report draft alone (not Finish's own)", async () => {
    db({ job: { ...JOB, document_id: null }, invoices: [{ ...BUILT, balance_for_job_id: null }] });
    expect(await recalculateJobDraft("j1")).toMatchObject({ error: expect.stringMatching(/service report/) });
  });

  it("refuses a service-report invoice even though it carries balance_for_job_id", async () => {
    db({ job: { ...JOB, document_id: null }, invoices: [{ ...BUILT, total: 250, line_items: { items: [{ category: "Parts" }, { category: "Labor" }] } }] });
    expect(await recalculateJobDraft("j1")).toMatchObject({ error: expect.stringMatching(/service report/) });
    expect(h.calls.some((c) => payload(c, "update"))).toBe(false);
  });

  it("a failed receipts read stops the rebuild instead of dropping the materials", async () => {
    h.handler = (call) => {
      if (call.table === "jobs") return { data: { ...JOB, document_id: null } };
      if (call.table === "job_time_entries") return { data: [] };
      if (call.table === "job_receipts") return { error: { message: "canceling statement due to statement timeout" } };
      if (call.table === "documents" && has(call, "or")) return { data: [BUILT] };
      return { data: null };
    };
    expect(await recalculateJobDraft("j1")).toMatchObject({ error: expect.stringMatching(/time or receipts/) });
    expect(h.calls.some((c) => payload(c, "update"))).toBe(false);
  });

  it("a job with a contract gets the balance line again (deposit math kept)", async () => {
    db({ linked: CONTRACT, invoices: [BUILT], updated: true });
    expect(await recalculateJobDraft("j1")).toEqual({ total: 5000, warnings: [] });
  });

  it("says so when the invoice was sent while recalculating", async () => {
    db({ job: { ...JOB, document_id: null }, invoices: [BUILT], updated: false });
    expect(await recalculateJobDraft("j1")).toMatchObject({ error: expect.stringMatching(/Nothing was changed/) });
  });
});
