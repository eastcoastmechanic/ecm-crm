import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  event: null as unknown,
  constructError: null as Error | null,
  docTotal: 1000 as number | null,
  docError: null as { message: string } | null,
  paidResult: { updated: true } as { updated: boolean; error?: string },
  markPaid: vi.fn(),
  customerUpdates: [] as unknown[],
}));

vi.mock("@/lib/stripe", () => ({
  stripe: {
    webhooks: {
      constructEvent: () => {
        if (h.constructError) throw h.constructError;
        return h.event;
      },
    },
  },
}));

vi.mock("@/lib/document-paid", () => ({
  markDocumentPaid: (...args: unknown[]) => {
    h.markPaid(...args);
    return Promise.resolve(h.paidResult);
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: { total: h.docTotal }, error: h.docError }),
        }),
      }),
      update: (values: unknown) => ({
        eq: () => {
          h.customerUpdates.push({ table, values });
          return Promise.resolve({ error: null });
        },
      }),
    }),
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

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  h.constructError = null;
  h.docTotal = 1000;
  h.docError = null;
  h.paidResult = { updated: true };
  h.markPaid.mockClear();
  h.customerUpdates = [];
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

  it("marks paid when paid and amount matches", async () => {
    session();
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(h.markPaid).toHaveBeenCalledWith("doc1", { source: "stripe", stripePaymentIntentId: "pi_1" });
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

  it("does not mark paid on an amount mismatch, and still answers 200", async () => {
    session({ amount_total: 50000 });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(h.markPaid).not.toHaveBeenCalled();
  });

  it("allows a one cent rounding difference", async () => {
    h.docTotal = 999.995;
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

  it("a replay (nothing updated) is still a clean 200", async () => {
    h.paidResult = { updated: false };
    session();
    expect((await POST(req())).status).toBe(200);
  });

  it("accepts an expanded payment_intent object", async () => {
    session({ payment_intent: { id: "pi_obj" } });
    await POST(req());
    expect(h.markPaid).toHaveBeenCalledWith("doc1", { source: "stripe", stripePaymentIntentId: "pi_obj" });
  });

  it("saves the Stripe customer id on the CRM customer", async () => {
    session();
    await POST(req());
    expect(h.customerUpdates).toEqual([{ table: "customers", values: { stripe_customer_id: "cus_1" } }]);
  });

  it("ignores other event types", async () => {
    h.event = { type: "charge.refunded", data: { object: {} } };
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(h.markPaid).not.toHaveBeenCalled();
  });
});
