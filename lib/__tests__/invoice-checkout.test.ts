import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  stripeCustomerId: null as string | null,
  create: vi.fn(),
}));

vi.mock("@/lib/stripe", () => ({
  stripe: { checkout: { sessions: { create: (...a: unknown[]) => h.create(...a) } } },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { stripe_customer_id: h.stripeCustomerId }, error: null }),
        }),
      }),
    }),
  },
}));

import { createDepositCheckoutSession, createInvoiceCheckoutSession } from "@/lib/invoice-checkout";

const doc = { id: "d1", doc_number: "INV-1", total: 250.5, customer_id: "c1" };
const urls = { success: "https://x/ok", cancel: "https://x/no" };

beforeEach(() => {
  h.stripeCustomerId = null;
  h.create.mockReset();
  h.create.mockResolvedValue({ url: "https://checkout" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("createInvoiceCheckoutSession", () => {
  it("makes a new Stripe customer only when the customer has none", async () => {
    await createInvoiceCheckoutSession(doc, urls);
    const params = h.create.mock.calls[0][0];
    expect(params.customer_creation).toBe("always");
    expect(params.customer).toBeUndefined();
    expect(params.line_items[0].price_data.unit_amount).toBe(25050);
    expect(params.metadata).toEqual({ document_id: "d1", customer_id: "c1" });
    expect(params.payment_intent_data).toEqual({
      setup_future_usage: "off_session",
      metadata: { document_id: "d1", customer_id: "c1" },
    });
  });

  it("reuses the saved Stripe customer so the renewal card stays on it", async () => {
    h.stripeCustomerId = "cus_saved";
    await createInvoiceCheckoutSession(doc, urls);
    const params = h.create.mock.calls[0][0];
    expect(params.customer).toBe("cus_saved");
    expect(params.customer_creation).toBeUndefined();
  });

  it("falls back to a new customer, flagged for the webhook, when the saved one was deleted", async () => {
    h.stripeCustomerId = "cus_dead";
    h.create.mockRejectedValueOnce(Object.assign(new Error("No such customer"), { code: "resource_missing", param: "customer" }));
    await createInvoiceCheckoutSession(doc, urls);
    const retry = h.create.mock.calls[1][0];
    expect(retry.customer_creation).toBe("always");
    expect(retry.metadata.replace_stripe_customer).toBe("cus_dead");
  });

  it("does not hide other Stripe errors", async () => {
    h.stripeCustomerId = "cus_saved";
    h.create.mockRejectedValueOnce(new Error("rate limited"));
    await expect(createInvoiceCheckoutSession(doc, urls)).rejects.toThrow("rate limited");
    expect(h.create).toHaveBeenCalledTimes(1);
  });
});

describe("createDepositCheckoutSession", () => {
  const contract = { id: "k1", doc_number: "CON-7", customer_id: "c1" };

  it("charges the deposit given, tagged kind=deposit for the webhook", async () => {
    h.stripeCustomerId = "cus_saved";
    await createDepositCheckoutSession(contract, 300000, urls);
    const [params, opts] = h.create.mock.calls[0];
    expect(params.line_items[0].price_data.unit_amount).toBe(300000);
    expect(params.line_items[0].price_data.product_data.name).toContain("Deposit on contract CON-7");
    expect(params.customer).toBe("cus_saved");
    expect(params.metadata).toEqual({ document_id: "k1", kind: "deposit", customer_id: "c1" });
    expect(params.payment_intent_data.metadata).toEqual({ document_id: "k1", kind: "deposit", customer_id: "c1" });
    expect(opts.idempotencyKey).toMatch(/^checkout-[0-9a-f]{64}$/);
  });

  it("uses the same idempotency key for the same request, a different one for a different amount", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    await createDepositCheckoutSession(contract, 300000, urls);
    await createDepositCheckoutSession(contract, 300000, urls);
    await createDepositCheckoutSession(contract, 250000, urls);
    const keys = h.create.mock.calls.map((c) => c[1].idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
    vi.restoreAllMocks();
  });

  it("refuses a missing or broken amount", async () => {
    await expect(createDepositCheckoutSession(contract, 0, urls)).rejects.toThrow();
    await expect(createDepositCheckoutSession(contract, 12.5, urls)).rejects.toThrow();
    expect(h.create).not.toHaveBeenCalled();
  });
});
