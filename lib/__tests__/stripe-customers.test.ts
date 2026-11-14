import { beforeEach, describe, expect, it, vi } from "vitest";

type UpdateRec = { values: Record<string, unknown>; id: unknown; isNull: unknown };

const h = vi.hoisted(() => ({
  customers: [] as Record<string, unknown>[],
  properties: [] as Record<string, unknown>[],
  search: vi.fn(),
  create: vi.fn(),
  updates: [] as { values: Record<string, unknown>; id: unknown; isNull: unknown }[],
  updateResult: { data: [{ id: "x" }], error: null } as { data: unknown[] | null; error: { message: string } | null },
}));

vi.mock("@/lib/stripe", () => ({
  stripe: { customers: { search: (...a: unknown[]) => h.search(...a), create: (...a: unknown[]) => h.create(...a) } },
}));

vi.mock("@/lib/supabase", () => {
  const select = (table: string) => {
    const rows = () => (table === "customers" ? h.customers : h.properties);
    const q = {
      order: () => q,
      range: (from: number, to: number) => Promise.resolve({ data: rows().slice(from, to + 1), error: null }),
    };
    return q;
  };
  return {
    supabase: {
      from: (table: string) => ({
        select: () => select(table),
        update: (values: Record<string, unknown>) => {
          const rec: UpdateRec = { values, id: null, isNull: null };
          const q = {
            eq: (_k: string, v: unknown) => {
              rec.id = v;
              return q;
            },
            is: (k: string) => {
              rec.isNull = k;
              return q;
            },
            select: () => {
              h.updates.push(rec);
              return Promise.resolve(h.updateResult);
            },
          };
          return q;
        },
      }),
    },
  };
});

import { createStripeCustomers } from "../stripe-customers";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";
const row = (id: string, o: Record<string, unknown> = {}) => ({
  id,
  name: "Pat",
  email: "pat@example.test",
  phone: null,
  billing_address: null,
  stripe_customer_id: null,
  ...o,
});

beforeEach(() => {
  h.customers = [row(A), row(B, { stripe_customer_id: "cus_have" }), row(C, { email: null })];
  h.properties = [{ customer_id: A, address: "5 Elm Rd, Bourne, MA 02532" }];
  h.updates = [];
  h.updateResult = { data: [{ id: "x" }], error: null };
  h.search.mockReset().mockResolvedValue({ data: [] });
  h.create
    .mockReset()
    .mockImplementation((p: { metadata: { crm_customer_id: string } }) =>
      Promise.resolve({ id: `cus_${p.metadata.crm_customer_id.slice(-1)}` })
    );
});

describe("createStripeCustomers", () => {
  it("dry run only counts and never calls Stripe", async () => {
    const r = await createStripeCustomers(true);
    expect(r).toMatchObject({ total: 3, alreadyHave: 1, noContact: 1, willCreate: 1, created: 0 });
    expect(h.search).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
    expect(h.updates).toEqual([]);
  });

  it("creates one Stripe customer with an idempotency key and saves the id only where empty", async () => {
    const r = await createStripeCustomers(false);
    expect(r).toMatchObject({ created: 1, reused: 0, failed: 0 });
    expect(h.search).toHaveBeenCalledWith({ query: `metadata['crm_customer_id']:'${A}'`, limit: 1 });
    expect(h.create).toHaveBeenCalledTimes(1);
    const [params, opts] = h.create.mock.calls[0];
    expect(params).toMatchObject({
      email: "pat@example.test",
      metadata: { crm_customer_id: A },
      address: { line1: "5 Elm Rd", city: "Bourne", state: "MA", postal_code: "02532" },
    });
    expect(opts).toEqual({ idempotencyKey: `crm-customer-${A}` });
    expect(h.updates).toEqual([{ values: { stripe_customer_id: "cus_a" }, id: A, isNull: "stripe_customer_id" }]);
  });

  it("reuses a Stripe customer an earlier run made", async () => {
    h.search.mockResolvedValue({ data: [{ id: "cus_old" }] });
    const r = await createStripeCustomers(false);
    expect(r).toMatchObject({ created: 0, reused: 1 });
    expect(h.create).not.toHaveBeenCalled();
    expect(h.updates[0].values).toEqual({ stripe_customer_id: "cus_old" });
  });

  it("one failure does not stop the rest", async () => {
    h.customers = [row(A), row(C, { phone: "5085550100" })];
    h.create.mockImplementation((p: { metadata: { crm_customer_id: string } }) =>
      p.metadata.crm_customer_id === A
        ? Promise.reject(Object.assign(new Error("bad"), { code: "email_invalid" }))
        : Promise.resolve({ id: "cus_c" })
    );
    const r = await createStripeCustomers(false);
    expect(r).toMatchObject({ created: 1, failed: 1, failCodes: ["email_invalid"] });
  });

  it("does not overwrite a row that got a Stripe id meanwhile", async () => {
    h.updateResult = { data: [], error: null };
    const r = await createStripeCustomers(false);
    expect(r).toMatchObject({ created: 0, failed: 1, failCodes: ["crm_changed_meanwhile"] });
  });
});
