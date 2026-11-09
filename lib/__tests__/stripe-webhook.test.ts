import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = {
  table: string;
  op: "select" | "update";
  cols: string;
  values?: Record<string, unknown>;
  filters: unknown[][];
};
type Result = { data: unknown; error: { message: string } | null };

const h = vi.hoisted(() => ({
  event: null as unknown,
  constructError: null as Error | null,
  // First read of the invoice (doc_number, total).
  doc: { doc_number: "INV-1", total: 1000, customers: { name: "Pat" } } as Record<string, unknown> | null,
  docError: null as { message: string } | null,
  // Re-read after markDocumentPaid changed nothing.
  paidDoc: { doc_number: "INV-1", status: "paid", stripe_payment_intent_id: "pi_1", payment_source: "stripe", customers: { name: "Pat" } } as Record<string, unknown> | null,
  recheckError: null as { message: string } | null,
  // Lookup by stripe_payment_intent_id (refund / dispute).
  piDocs: [] as unknown[],
  // Lookup by id after reading the payment's metadata.
  docById: null as unknown,
  customerRows: [{ id: "c1" }] as unknown[],
  customerError: null as { message: string } | null,
  contractError: null as { message: string } | null,
  paidResult: { updated: true } as { updated: boolean; error?: string },
  markPaid: vi.fn(),
  notify: vi.fn(),
  retrieve: vi.fn(),
  calls: [] as Call[],
}));

vi.mock("@/lib/stripe", () => ({
  stripe: {
    webhooks: {
      constructEvent: () => {
        if (h.constructError) throw h.constructError;
        return h.event;
      },
    },
    paymentIntents: { retrieve: (...a: unknown[]) => h.retrieve(...a) },
  },
}));

vi.mock("@/lib/document-paid", () => ({
  markDocumentPaid: (...args: unknown[]) => {
    h.markPaid(...args);
    return Promise.resolve(h.paidResult);
  },
}));

vi.mock("@/lib/notify-owner", () => ({
  notifyOwnerOfMoney: (...a: unknown[]) => {
    h.notify(...a);
    return Promise.resolve();
  },
  centsToMoney: (c: number) => `$${((c ?? 0) / 100).toFixed(2)}`,
}));

function resultFor(call: Call): Result {
  const eq = (col: string) => call.filters.find((f) => f[0] === "eq" && f[1] === col)?.[2];
  if (call.table === "documents" && call.op === "select") {
    if (eq("stripe_payment_intent_id")) return { data: h.piDocs, error: null };
    if (call.cols.includes("stripe_payment_intent_id")) return { data: h.paidDoc, error: h.recheckError };
    if (call.cols.startsWith("id,")) return { data: h.docById, error: null };
    return { data: h.doc, error: h.docError };
  }
  if (call.table === "customers") return { data: h.customerRows, error: h.customerError };
  if (call.table === "service_contracts") return { data: null, error: h.contractError };
  return { data: null, error: null };
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      const call: Call = { table, op: "select", cols: "", filters: [] };
      const done = () => {
        h.calls.push(call);
        return Promise.resolve(resultFor(call));
      };
      const b: Record<string, unknown> = {
        select: (cols: string) => {
          call.cols = cols;
          return b;
        },
        update: (values: Record<string, unknown>) => {
          call.op = "update";
          call.values = values;
          return b;
        },
        single: done,
        maybeSingle: done,
        then: (res: (v: Result) => unknown, rej: (e: unknown) => unknown) => done().then(res, rej),
      };
      for (const m of ["eq", "in", "is", "not", "or", "limit"]) {
        b[m] = (...args: unknown[]) => {
          call.filters.push([m, ...args]);
          return b;
        };
      }
      return b;
    },
  },
}));

import { POST } from "@/app/api/stripe/webhook/route";

function req(sig: string | null = "sig") {
  return new Request("http://x/api/stripe/webhook", {
    method: "POST",
    body: "{}",
    headers: sig ? { "stripe-signature": sig } : {},
  });
}

function session(over: Record<string, unknown> = {}, type = "checkout.session.completed") {
  h.event = {
    type,
    data: {
      object: {
        id: "cs_1",
        payment_status: "paid",
        amount_total: 100000,
        payment_intent: "pi_1",
        customer: "cus_1",
        metadata: { document_id: "doc1", customer_id: "c1" },
        ...over,
      },
    },
  };
}

function lastAlert() {
  return h.notify.mock.calls.at(-1)?.[0] as { title: string; body?: string; path?: string } | undefined;
}

const updates = (table: string) => h.calls.filter((c) => c.table === table && c.op === "update");

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  h.constructError = null;
  h.doc = { doc_number: "INV-1", total: 1000, customers: { name: "Pat" } };
  h.docError = null;
  h.paidDoc = { doc_number: "INV-1", status: "paid", stripe_payment_intent_id: "pi_1", payment_source: "stripe", customers: { name: "Pat" } };
  h.recheckError = null;
  h.piDocs = [];
  h.docById = null;
  h.customerRows = [{ id: "c1" }];
  h.customerError = null;
  h.contractError = null;
  h.paidResult = { updated: true };
  h.markPaid.mockClear();
  h.notify.mockClear();
  h.retrieve.mockReset();
  h.calls = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("stripe webhook", () => {
  it("rejects a missing signature", async () => {
    expect((await POST(req(null))).status).toBe(400);
  });

  it("rejects a missing secret", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect((await POST(req())).status).toBe(400);
  });

  it("rejects a bad signature", async () => {
    h.constructError = new Error("bad sig");
    const res = await POST(req());
    expect(res.status).toBe(400);
    expect(h.markPaid).not.toHaveBeenCalled();
  });

  it("marks paid when paid and amount matches, with no alert of its own", async () => {
    session();
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(h.markPaid).toHaveBeenCalledWith("doc1", { source: "stripe", stripePaymentIntentId: "pi_1" });
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("ignores an unpaid (delayed payment) session", async () => {
    session({ payment_status: "unpaid" });
    await POST(req());
    expect(h.markPaid).not.toHaveBeenCalled();
  });

  it("marks paid on async_payment_succeeded", async () => {
    session({}, "checkout.session.async_payment_succeeded");
    await POST(req());
    expect(h.markPaid).toHaveBeenCalledTimes(1);
  });

  it("allows a one cent rounding difference", async () => {
    h.doc = { doc_number: "INV-1", total: 999.995 };
    session({ amount_total: 100000 });
    await POST(req());
    expect(h.markPaid).toHaveBeenCalled();
  });

  it("returns 500 so Stripe retries when the document read fails", async () => {
    h.docError = { message: "db down" };
    session();
    expect((await POST(req())).status).toBe(500);
    expect(h.markPaid).not.toHaveBeenCalled();
  });

  it("returns 500 when marking paid fails", async () => {
    h.paidResult = { updated: false, error: "boom" };
    session();
    expect((await POST(req())).status).toBe(500);
  });

  it("accepts an expanded payment_intent object", async () => {
    session({ payment_intent: { id: "pi_obj" } });
    await POST(req());
    expect(h.markPaid).toHaveBeenCalledWith("doc1", { source: "stripe", stripePaymentIntentId: "pi_obj" });
  });

  describe("amount mismatch", () => {
    it("does not mark paid, alerts the owner with both amounts, and still answers 200", async () => {
      session({ amount_total: 50000 });
      const res = await POST(req());
      expect(res.status).toBe(200);
      expect(h.markPaid).not.toHaveBeenCalled();
      const alert = lastAlert();
      expect(alert?.title).toMatch(/does not match/);
      expect(alert?.title).toContain("INV-1");
      expect(alert?.body).toContain("$500.00");
      expect(alert?.body).toContain("$1000.00");
      expect(alert?.body).toMatch(/NOT marked paid/);
      expect(alert?.path).toBe("/documents/doc1");
    });
  });

  describe("payment on an already-paid document", () => {
    it("a replay of the same payment is a clean 200 with no alert", async () => {
      h.paidResult = { updated: false };
      session();
      expect((await POST(req())).status).toBe(200);
      expect(h.notify).not.toHaveBeenCalled();
    });

    it("a different Stripe payment alerts possible double payment", async () => {
      h.paidResult = { updated: false };
      h.paidDoc = { ...h.paidDoc, stripe_payment_intent_id: "pi_old" };
      session({ payment_intent: "pi_new" });
      expect((await POST(req())).status).toBe(200);
      const alert = lastAlert();
      expect(alert?.title).toMatch(/Possible double payment, refund one/);
      expect(alert?.title).toContain("INV-1");
      expect(alert?.body).toContain("$1000.00");
      expect(alert?.body).toContain("pi_new");
      expect(alert?.body).toContain("pi_old");
    });

    it("a Stripe payment on a document marked paid by cash or check alerts too", async () => {
      h.paidResult = { updated: false };
      h.paidDoc = { ...h.paidDoc, stripe_payment_intent_id: null, payment_source: "cash_check" };
      session();
      await POST(req());
      expect(lastAlert()?.body).toMatch(/cash or check/);
    });

    it("alerts anyway when the re-read fails (better a false alarm than a missed double charge)", async () => {
      h.paidResult = { updated: false };
      h.recheckError = { message: "db down" };
      session();
      expect((await POST(req())).status).toBe(200);
      expect(lastAlert()?.title).toMatch(/double payment/);
    });

    it("no alert when the document turns out not to be paid", async () => {
      h.paidResult = { updated: false };
      h.paidDoc = { ...h.paidDoc, status: "sent", stripe_payment_intent_id: null };
      session();
      await POST(req());
      expect(h.notify).not.toHaveBeenCalled();
    });
  });

  describe("saving the Stripe customer", () => {
    it("saves it only on a customer that has none", async () => {
      session();
      await POST(req());
      const [u] = updates("customers");
      expect(u.values).toEqual({ stripe_customer_id: "cus_1" });
      expect(u.filters).toContainEqual(["eq", "id", "c1"]);
      expect(u.filters).toContainEqual(["is", "stripe_customer_id", null]);
      expect(updates("service_contracts")).toEqual([]);
    });

    it("returns 500 so Stripe retries when the save fails", async () => {
      h.customerError = { message: "db down" };
      session();
      expect((await POST(req())).status).toBe(500);
    });

    it("replaces a dead Stripe customer and clears the card saved on it", async () => {
      session({ metadata: { document_id: "doc1", customer_id: "c1", replace_stripe_customer: "cus_dead" } });
      expect((await POST(req())).status).toBe(200);
      const [u] = updates("customers");
      // Matches the dead id, or the new one on a retry after a failed cleanup.
      expect(u.filters).toContainEqual(["in", "stripe_customer_id", ["cus_dead", "cus_1"]]);
      const [pm] = updates("service_contracts");
      expect(pm.values).toEqual({ stripe_payment_method_id: null });
      expect(pm.filters).toContainEqual(["eq", "customer_id", "c1"]);
    });

    it("returns 500 when clearing the old card fails, so Stripe retries the cleanup", async () => {
      h.contractError = { message: "db down" };
      session({ metadata: { document_id: "doc1", customer_id: "c1", replace_stripe_customer: "cus_dead" } });
      expect((await POST(req())).status).toBe(500);
      // The retry still matches the row (now holding cus_1) and clears the card again.
      h.contractError = null;
      h.calls = [];
      expect((await POST(req())).status).toBe(200);
      expect(updates("service_contracts")).toHaveLength(1);
    });

    it("leaves the saved card alone when the dead id was already replaced", async () => {
      h.customerRows = [];
      session({ metadata: { document_id: "doc1", customer_id: "c1", replace_stripe_customer: "cus_dead" } });
      await POST(req());
      expect(updates("service_contracts")).toEqual([]);
    });

    it("does nothing without a customer on the session", async () => {
      session({ customer: null });
      await POST(req());
      expect(updates("customers")).toEqual([]);
    });
  });

  describe("charge.refunded", () => {
    const refund = (over: Record<string, unknown> = {}) => {
      h.event = {
        type: "charge.refunded",
        data: { object: { id: "ch_1", payment_intent: "pi_1", amount: 100000, amount_refunded: 100000, ...over } },
      };
    };

    it("alerts with the document found by its payment, and changes nothing", async () => {
      h.piDocs = [{ id: "doc1", doc_number: "INV-1", customers: { name: "Pat" } }];
      refund();
      const res = await POST(req());
      expect(res.status).toBe(200);
      const alert = lastAlert();
      expect(alert?.title).toBe("Stripe refund: $1000.00 (INV-1, Pat)");
      expect(alert?.body).toMatch(/Full refund/);
      expect(alert?.path).toBe("/documents/doc1");
      expect(h.markPaid).not.toHaveBeenCalled();
      expect(h.calls.filter((c) => c.op === "update")).toEqual([]);
    });

    it("says partial refund when only part came back", async () => {
      h.piDocs = [{ id: "doc1", doc_number: "INV-1" }];
      refund({ amount_refunded: 25000 });
      await POST(req());
      expect(lastAlert()?.body).toMatch(/Partial refund: \$250\.00 refunded so far of \$1000\.00/);
    });

    it("falls back to the payment's metadata when no document holds the payment id", async () => {
      h.retrieve.mockResolvedValue({ metadata: { document_id: "doc9" } });
      h.docById = { id: "doc9", doc_number: "INV-9" };
      refund();
      await POST(req());
      expect(h.retrieve).toHaveBeenCalledWith("pi_1");
      expect(lastAlert()?.title).toContain("INV-9");
      expect(lastAlert()?.path).toBe("/documents/doc9");
    });

    it("names a plan renewal charge", async () => {
      h.retrieve.mockResolvedValue({ metadata: { service_contract_id: "sc1" } });
      refund();
      await POST(req());
      expect(lastAlert()?.title).toContain("plan renewal charge");
    });

    it("still alerts and answers 200 when the lookup throws", async () => {
      h.retrieve.mockRejectedValue(new Error("stripe down"));
      refund();
      expect((await POST(req())).status).toBe(200);
      expect(lastAlert()?.title).toContain("payment pi_1");
    });
  });

  describe("charge.dispute.created", () => {
    it("alerts with amount, reason and the document, and answers 200", async () => {
      h.piDocs = [{ id: "doc1", doc_number: "INV-1", customers: { name: "Pat" } }];
      h.event = {
        type: "charge.dispute.created",
        data: {
          object: {
            id: "dp_1",
            payment_intent: "pi_1",
            amount: 100000,
            reason: "product_not_received",
            evidence_details: { due_by: 1767225600 },
          },
        },
      };
      const res = await POST(req());
      expect(res.status).toBe(200);
      const alert = lastAlert();
      expect(alert?.title).toBe("Card dispute opened: $1000.00 (INV-1, Pat)");
      expect(alert?.body).toMatch(/product not received/);
      expect(alert?.body).toMatch(/Respond in the Stripe dashboard by .+ ET/);
      expect(alert?.path).toBe("/documents/doc1");
      expect(h.calls.filter((c) => c.op === "update")).toEqual([]);
    });
  });

  it("answers 200 and does nothing for other event types", async () => {
    h.event = { type: "invoice.created", data: { object: {} } };
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(h.markPaid).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
  });
});
