import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  job: null as Record<string, unknown> | null,
  jobError: null as { message: string } | null,
  existing: [] as unknown[],
  contract: null as Record<string, unknown> | null,
  createInvoice: vi.fn(),
  createError: null as Error | null,
  redirected: null as string | null,
}));

vi.mock("@/lib/require-role", () => ({ requireOffice: () => Promise.resolve(), getStaffRole: () => Promise.resolve("office") }));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    h.redirected = url;
    throw new Error("NEXT_REDIRECT");
  },
}));

vi.mock("@/lib/document-generation", () => ({
  createInvoiceDirect: (input: unknown) => {
    h.createInvoice(input);
    if (h.createError) return Promise.reject(h.createError);
    return Promise.resolve({ documentId: "inv1" });
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "neq", "or", "order"]) chain[m] = () => chain;
      chain.maybeSingle = () =>
        table === "jobs"
          ? Promise.resolve({ data: h.job, error: h.jobError })
          : Promise.resolve({ data: h.contract, error: null });
      chain.limit = () => Promise.resolve({ data: h.existing, error: null });
      return chain;
    },
  },
}));

import { createBalanceInvoice } from "@/app/(internal)/jobs/invoice-actions";

function form(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

beforeEach(() => {
  h.job = { id: "j1", status: "complete", customer_id: "c1", property_id: "p1", document_id: "d1" };
  h.jobError = null;
  h.existing = [];
  h.contract = { doc_number: "C-1001", type: "contract", total: 10000, deposit_received_cents: 500000 };
  h.createError = null;
  h.redirected = null;
  h.createInvoice.mockClear();
});

describe("createBalanceInvoice", () => {
  it("needs a job", async () => {
    expect(await createBalanceInvoice(null, form({ amount: "100" }))).toEqual({ error: "Missing job." });
  });

  it("rejects a blank, zero or junk amount", async () => {
    for (const amount of ["", "0", "abc", "-5"]) {
      const res = await createBalanceInvoice(null, form({ job_id: "j1", amount }));
      expect(res).toEqual({ error: "Enter the amount to invoice." });
    }
    expect(h.createInvoice).not.toHaveBeenCalled();
  });

  it("refuses a job that is not found", async () => {
    h.job = null;
    expect(await createBalanceInvoice(null, form({ job_id: "j1", amount: "100" }))).toEqual({ error: "Job not found." });
  });

  it("refuses an unfinished job", async () => {
    h.job = { ...h.job!, status: "in_progress" };
    const res = await createBalanceInvoice(null, form({ job_id: "j1", amount: "100" }));
    expect(res).toEqual({ error: "Finish the job before invoicing it." });
    expect(h.createInvoice).not.toHaveBeenCalled();
  });

  it("refuses a job with no customer", async () => {
    h.job = { ...h.job!, customer_id: null };
    const res = await createBalanceInvoice(null, form({ job_id: "j1", amount: "100" }));
    expect(res).toEqual({ error: "This job has no customer. Add one first." });
  });

  it("refuses when the job already has a live invoice", async () => {
    h.existing = [{ id: "inv0" }];
    const res = await createBalanceInvoice(null, form({ job_id: "j1", amount: "100" }));
    expect(res).toEqual({ error: "This job already has an invoice." });
    expect(h.createInvoice).not.toHaveBeenCalled();
  });

  it("creates the invoice for exactly the typed amount and opens it", async () => {
    await expect(createBalanceInvoice(null, form({ job_id: "j1", amount: "$5,000.50" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(h.redirected).toBe("/documents/inv1");
    const input = h.createInvoice.mock.calls[0][0];
    expect(input.customerId).toBe("c1");
    expect(input.propertyId).toBe("p1");
    expect(input.jobId).toBe("j1");
    expect(input.extra).toEqual({ balance_for_job_id: "j1" });
    expect(input.items).toHaveLength(1);
    expect(input.items[0].unit_price).toBe(5000.5);
    expect(input.items[0].description).toBe("Balance due on contract C-1001");
    expect(input.items[0].notes).toBe("Contract total $10,000.00, deposit received $5,000.00");
  });

  it("falls back to a plain description when the job has no contract", async () => {
    h.job = { ...h.job!, document_id: null };
    await expect(createBalanceInvoice(null, form({ job_id: "j1", amount: "250" }))).rejects.toThrow("NEXT_REDIRECT");
    const input = h.createInvoice.mock.calls[0][0];
    expect(input.items[0].description).toBe("Balance due for completed work");
    expect(input.items[0].notes).toBeNull();
  });

  it("does not claim a deposit when none is on file", async () => {
    h.contract = { doc_number: "C-1", type: "contract", total: 2000, deposit_received_cents: null };
    await expect(createBalanceInvoice(null, form({ job_id: "j1", amount: "100" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(h.createInvoice.mock.calls[0][0].items[0].notes).toBe("Contract total $2,000.00");
  });

  it("turns the database's one-balance-invoice guard into a friendly message", async () => {
    h.createError = new Error('duplicate key value violates unique constraint "documents_one_balance_invoice_per_job_idx"');
    const res = await createBalanceInvoice(null, form({ job_id: "j1", amount: "100" }));
    expect(res).toEqual({ error: "This job already has an invoice." });
    expect(h.redirected).toBeNull();
  });

  it("tells the owner to run SQL 0058 when the column is missing", async () => {
    h.createError = new Error('column "balance_for_job_id" of relation "documents" does not exist');
    const res = await createBalanceInvoice(null, form({ job_id: "j1", amount: "100" }));
    expect(res?.error).toMatch(/SQL 0058/);
  });

  it("returns other failures inline", async () => {
    h.createError = new Error("boom");
    expect(await createBalanceInvoice(null, form({ job_id: "j1", amount: "100" }))).toEqual({ error: "boom" });
  });
});
