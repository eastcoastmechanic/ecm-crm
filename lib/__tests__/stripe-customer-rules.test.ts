import { describe, expect, it } from "vitest";
import {
  crmIdSearchQuery,
  parseUsAddress,
  planStripeCustomers,
  stripeCustomerIdempotencyKey,
  stripeCustomerParams,
  stripeMode,
  usableEmail,
  type StripeCrmCust,
} from "../stripe-customer-rules";

const ID = "0b6a8f1e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
const cust = (o: Partial<StripeCrmCust> = {}): StripeCrmCust => ({
  id: ID,
  name: "Ann Lee",
  email: "ann@example.test",
  phone: null,
  billing_address: null,
  stripe_customer_id: null,
  ...o,
});

describe("planStripeCustomers", () => {
  it("creates only for customers with no Stripe id and an email or phone", () => {
    const plan = planStripeCustomers([
      cust({ id: "a" }),
      cust({ id: "b", email: null, phone: "(508) 555-0100" }),
      cust({ id: "c", stripe_customer_id: "cus_1" }),
      cust({ id: "d", email: "12 Main St", phone: "" }),
    ]);
    expect(plan.toCreate.map((c) => c.id)).toEqual(["a", "b"]);
    expect(plan.alreadyHave).toBe(1);
    expect(plan.noContact).toBe(1);
  });
});

describe("stripeCustomerParams", () => {
  it("sends name, email, phone, address and the CRM id", () => {
    expect(
      stripeCustomerParams(cust({ phone: "+15085550100", billing_address: "12 Main St, Unit 2, Plymouth, MA 02360" }))
    ).toEqual({
      name: "Ann Lee",
      email: "ann@example.test",
      phone: "+15085550100",
      address: { line1: "12 Main St", line2: "Unit 2", city: "Plymouth", state: "MA", postal_code: "02360", country: "US" },
      metadata: { crm_customer_id: ID },
    });
  });
  it("uses the property address when there is no billing address, and leaves out a bad email", () => {
    const p = stripeCustomerParams(cust({ email: "not an email", phone: "5085550100" }), "5 Elm Rd, Bourne, ma 02532");
    expect(p.email).toBeUndefined();
    expect(p.address).toEqual({ line1: "5 Elm Rd", city: "Bourne", state: "MA", postal_code: "02532", country: "US" });
  });
  it("puts an address it can't split into line1 instead of guessing", () => {
    expect(parseUsAddress("12 Main St Plymouth")).toEqual({ line1: "12 Main St Plymouth", country: "US" });
    expect(parseUsAddress("  ")).toBeUndefined();
  });
  it("has no address when none is known", () => {
    expect(stripeCustomerParams(cust()).address).toBeUndefined();
  });
});

describe("helpers", () => {
  it("keeps one idempotency key per CRM customer", () => {
    expect(stripeCustomerIdempotencyKey(ID)).toBe(`crm-customer-${ID}`);
  });
  it("only searches for UUID ids", () => {
    expect(crmIdSearchQuery(ID)).toBe(`metadata['crm_customer_id']:'${ID}'`);
    expect(crmIdSearchQuery("x' OR '1")).toBeNull();
  });
  it("checks email shape", () => {
    expect(usableEmail(" a@b.co ")).toBe("a@b.co");
    expect(usableEmail("a@b")).toBeNull();
    expect(usableEmail("a@b.co, c@d.co")).toBeNull();
  });
  it("reads live or test mode from the key prefix", () => {
    expect(stripeMode("sk_live_x")).toBe("live");
    expect(stripeMode("rk_test_x")).toBe("test");
    expect(stripeMode(undefined)).toBeNull();
  });
});
