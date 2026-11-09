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

import { createInvoiceCheckoutSession } from "@/lib/invoice-checkout";

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
