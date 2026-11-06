import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  selectResult: { data: [] as unknown[], error: null as null | { message: string } },
  updateErrors: [] as ({ message: string } | null)[],
  calls: [] as { method: string; args: unknown[] }[],
  updates: [] as { table: string; patch: Record<string, unknown>; id?: unknown }[],
  stripe: {
    paymentIntents: { create: vi.fn() },
    paymentMethods: { list: vi.fn() },
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      let mode: "select" | "update" = "select";
      let patch: Record<string, unknown> = {};
      let id: unknown;
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "not", "gt", "gte", "lte", "is", "lt", "or"]) {
        builder[m] = (...args: unknown[]) => {
          h.calls.push({ method: m, args });
          if (m === "eq" && args[0] === "id") id = args[1];
          return builder;
        };
      }
      builder.update = (p: Record<string, unknown>) => {
        mode = "update";
        patch = p;
        return builder;
      };
      builder.then = (resolve: (v: unknown) => void) => {
        if (mode === "update") {
          h.updates.push({ table, patch, id });
          resolve({ error: h.updateErrors.shift() ?? null });
        } else {
          resolve(h.selectResult);
        }
      };
      return builder;
    },
  },
}));
vi.mock("@/lib/stripe", () => ({ stripe: h.stripe }));

import { addOneYear, sendMaintenancePlanCharges } from "../plan-renewal";

const customer = { id: "cus-row", name: "Pat", email: "pat@example.test", stripe_customer_id: "cus_123" };
const contract = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  plan_name: "Annual Maintenance Plan",
  end_date: "2026-11-10",
  renewal_price_cents: 29900,
  stripe_payment_method_id: "pm_saved",
  customers: customer, // many-to-one: Supabase returns an object
  ...over,
});

beforeEach(() => {
  h.selectResult = { data: [], error: null };
  h.updateErrors = [];
  h.calls = [];
  h.updates = [];
  h.stripe.paymentIntents.create.mockReset();
  h.stripe.paymentMethods.list.mockReset();
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("addOneYear", () => {
  it("moves a plain date forward one year", () => {
    expect(addOneYear("2026-11-10")).toBe("2027-11-10");
  });
  it("rolls Feb 29 to Mar 1 in a non-leap year", () => {
    expect(addOneYear("2028-02-29")).toBe("2029-03-01");
  });
});

describe("sendMaintenancePlanCharges", () => {
  it("only asks for active, auto-renew-authorized, priced, not-yet-billed contracts", async () => {
    await sendMaintenancePlanCharges();
    const has = (method: string, ...args: unknown[]) =>
      h.calls.some((c) => c.method === method && args.every((a, i) => c.args[i] === a));
    expect(has("eq", "status", "active")).toBe(true);
    expect(has("not", "auto_renew_authorized_at", "is", null)).toBe(true);
    expect(has("gt", "renewal_price_cents", 0)).toBe(true);
    expect(has("is", "auto_billed_at", null)).toBe(true);
  });

  it("charges the saved card the renewal price once per term, then rolls the plan a year", async () => {
    h.selectResult.data = [contract()];
    h.stripe.paymentIntents.create.mockResolvedValue({ id: "pi_1", status: "succeeded" });

    const out = await sendMaintenancePlanCharges();

    expect(out).toEqual({ charged: 1, skipped: 0, errors: [] });
    const [params, options] = h.stripe.paymentIntents.create.mock.calls[0];
    expect(params).toMatchObject({
      amount: 29900,
      currency: "usd",
      customer: "cus_123",
      payment_method: "pm_saved",
      off_session: true,
      confirm: true,
      metadata: { service_contract_id: "c1" },
    });
    expect(options).toEqual({ idempotencyKey: "plan-renewal-c1-2026-11-10" });
    expect(h.updates).toEqual([
      {
        table: "service_contracts",
        id: "c1",
        patch: {
          end_date: "2027-11-10",
          auto_billed_at: null,
          renewal_reminder_sent_at: null,
          stripe_payment_method_id: "pm_saved",
        },
      },
    ]);
  });

  it("still finds the customer if Supabase hands back a one-item list", async () => {
    h.selectResult.data = [contract({ customers: [customer] })];
    h.stripe.paymentIntents.create.mockResolvedValue({ id: "pi_1", status: "succeeded" });
    expect((await sendMaintenancePlanCharges()).charged).toBe(1);
  });

  it("falls back to the customer's first card when the contract has none saved", async () => {
    h.selectResult.data = [contract({ stripe_payment_method_id: null })];
    h.stripe.paymentMethods.list.mockResolvedValue({ data: [{ id: "pm_first" }] });
    h.stripe.paymentIntents.create.mockResolvedValue({ id: "pi_1", status: "succeeded" });

    await sendMaintenancePlanCharges();

    expect(h.stripe.paymentMethods.list).toHaveBeenCalledWith({ customer: "cus_123", type: "card" });
    expect(h.stripe.paymentIntents.create.mock.calls[0][0].payment_method).toBe("pm_first");
    expect(h.updates[0].patch.stripe_payment_method_id).toBe("pm_first");
  });

  it("skips, without charging, when the customer has no Stripe record", async () => {
    h.selectResult.data = [contract({ customers: { ...customer, stripe_customer_id: null } })];
    const out = await sendMaintenancePlanCharges();
    expect(out).toEqual({ charged: 0, skipped: 1, errors: [] });
    expect(h.stripe.paymentIntents.create).not.toHaveBeenCalled();
  });

  it("skips, without charging, when there is no customer on the contract", async () => {
    h.selectResult.data = [contract({ customers: null })];
    expect((await sendMaintenancePlanCharges()).skipped).toBe(1);
    expect(h.stripe.paymentIntents.create).not.toHaveBeenCalled();
  });

  it("skips, without charging, when there is no card to charge", async () => {
    h.selectResult.data = [contract({ stripe_payment_method_id: null })];
    h.stripe.paymentMethods.list.mockResolvedValue({ data: [] });
    expect(await sendMaintenancePlanCharges()).toEqual({ charged: 0, skipped: 1, errors: [] });
    expect(h.stripe.paymentIntents.create).not.toHaveBeenCalled();
  });

  it("does not roll the term when the charge did not succeed", async () => {
    h.selectResult.data = [contract()];
    h.stripe.paymentIntents.create.mockResolvedValue({ id: "pi_1", status: "requires_action" });

    const out = await sendMaintenancePlanCharges();

    expect(out.charged).toBe(0);
    expect(out.errors[0]).toMatch(/contract c1: charge not completed \(status requires_action\)/);
    expect(h.updates).toEqual([]);
  });

  it("marks the term billed if the card was charged but extending the plan failed", async () => {
    h.selectResult.data = [contract()];
    h.stripe.paymentIntents.create.mockResolvedValue({ id: "pi_1", status: "succeeded" });
    h.updateErrors = [{ message: "db down" }];

    const out = await sendMaintenancePlanCharges();

    expect(out.charged).toBe(1);
    expect(out.errors[0]).toMatch(/charged \(pi_1\) but term not extended: db down/);
    expect(h.updates).toHaveLength(2);
    expect(h.updates[1].patch).toMatchObject({ stripe_payment_method_id: "pm_saved" });
    expect(typeof h.updates[1].patch.auto_billed_at).toBe("string");
  });

  it("keeps going after one contract's charge throws", async () => {
    h.selectResult.data = [contract({ id: "bad" }), contract({ id: "good" })];
    h.stripe.paymentIntents.create
      .mockRejectedValueOnce(new Error("card_declined"))
      .mockResolvedValueOnce({ id: "pi_2", status: "succeeded" });

    const out = await sendMaintenancePlanCharges();

    expect(out.charged).toBe(1);
    expect(out.errors).toEqual(["contract bad: card_declined"]);
    expect(h.updates.map((u) => u.id)).toEqual(["good"]);
  });

  it("reports a failed contract read instead of charging anyone", async () => {
    h.selectResult = { data: [], error: { message: "read failed" } };
    expect(await sendMaintenancePlanCharges()).toEqual({ charged: 0, skipped: 0, errors: ["read failed"] });
    expect(h.stripe.paymentIntents.create).not.toHaveBeenCalled();
  });
});
