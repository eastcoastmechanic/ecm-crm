import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  class StripeCardError extends Error {
    code?: string;
    constructor(message: string, code?: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    customer: { name: "Pat", stripe_customer_id: "cus_1" } as Record<string, unknown> | null,
    cards: [{ id: "pm_1", card: { brand: "visa", last4: "4242" } }] as unknown[],
    create: vi.fn(),
    notify: vi.fn(),
    StripeCardError,
  };
});

vi.mock("@/lib/stripe", () => ({
  stripe: {
    paymentMethods: { list: () => Promise.resolve({ data: h.cards }) },
    paymentIntents: { create: (...a: unknown[]) => h.create(...a) },
    errors: { StripeCardError: h.StripeCardError },
  },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ single: () => Promise.resolve({ data: h.customer, error: null }) }),
      }),
    }),
  },
}));
vi.mock("@/lib/notify-owner", () => ({
  notifyOwnerOfMoney: (...a: unknown[]) => {
    h.notify(...a);
    return Promise.resolve();
  },
}));

import { chargeCustomerCard } from "@/lib/customer-charges";

const alert = () => h.notify.mock.calls.at(-1)?.[0] as { title: string; body?: string };

beforeEach(() => {
  h.customer = { name: "Pat", stripe_customer_id: "cus_1" };
  h.cards = [{ id: "pm_1", card: { brand: "visa", last4: "4242" } }];
  h.create.mockReset();
  h.notify.mockClear();
});

describe("chargeCustomerCard", () => {
  it("sends the idempotency key and only says Charged on succeeded", async () => {
    h.create.mockResolvedValue({ id: "pi_1", status: "succeeded" });
    const out = await chargeCustomerCard("c1", 50, "Filter", "assistant-charge-tok1");
    expect(out).toMatch(/^Charged \$50\.00 to Pat's visa ending 4242/);
    const [params, options] = h.create.mock.calls[0];
    expect(params).toMatchObject({ amount: 5000, customer: "cus_1", payment_method: "pm_1", off_session: true, confirm: true });
    expect(options).toEqual({ idempotencyKey: "assistant-charge-tok1" });
    expect(alert().title).toBe("Card charged: Pat, $50.00");
  });

  it("says processing, not charged, while the bank is still working", async () => {
    h.create.mockResolvedValue({ id: "pi_1", status: "processing" });
    const out = await chargeCustomerCard("c1", 50, "Filter", "k");
    expect(out).not.toMatch(/^Charged/);
    expect(out).toMatch(/still processing/);
    expect(alert().title).toMatch(/processing/);
  });

  it("throws, and alerts, when the charge did not complete", async () => {
    h.create.mockResolvedValue({ id: "pi_1", status: "requires_action" });
    await expect(chargeCustomerCard("c1", 50, "Filter", "k")).rejects.toThrow(/did not go through \(status requires_action/);
    expect(alert().title).toBe("Card charge failed: Pat, $50.00");
  });

  it("explains a card that needs the customer to approve it", async () => {
    h.create.mockRejectedValue(new h.StripeCardError("auth", "authentication_required"));
    await expect(chargeCustomerCard("c1", 50, "Filter", "k")).rejects.toThrow(/3D Secure/);
    expect(alert().title).toMatch(/failed/);
  });

  it("reports a decline", async () => {
    h.create.mockRejectedValue(new h.StripeCardError("Your card was declined.", "card_declined"));
    await expect(chargeCustomerCard("c1", 50, "Filter", "k")).rejects.toThrow("Card declined: Your card was declined.");
    expect(alert().body).toContain("Card declined");
  });

  it("refuses without a saved card, before calling Stripe", async () => {
    h.cards = [];
    await expect(chargeCustomerCard("c1", 50, "Filter", "k")).rejects.toThrow(/no saved card/);
    expect(h.create).not.toHaveBeenCalled();
  });
});
