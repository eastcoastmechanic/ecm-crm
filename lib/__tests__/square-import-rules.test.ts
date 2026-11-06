import { describe, expect, it } from "vitest";
import { IMPORTED_SMS_CONSENT, planCustomerImport, squareDisplayName, squareWritesEnabled } from "../square-import-rules";

const crm = (o: Partial<{ id: string; email: string | null; phone: string | null; square_customer_id: string | null }>) => ({
  id: "c1",
  email: null,
  phone: null,
  square_customer_id: null,
  ...o,
});

describe("planCustomerImport", () => {
  it("creates customers that are not in the CRM, from Square data only", () => {
    const plan = planCustomerImport([{ id: "S1", given_name: "Ann", family_name: "Lee", email_address: "ann@x.com" }], []);
    expect(plan.toCreate).toEqual([
      { square_customer_id: "S1", name: "Ann Lee", company_name: null, email: "ann@x.com", phone: null },
    ]);
  });
  it("skips customers already linked", () => {
    const plan = planCustomerImport([{ id: "S1", given_name: "Ann" }], [crm({ square_customer_id: "S1" })]);
    expect(plan.alreadyLinked).toBe(1);
    expect(plan.toCreate).toHaveLength(0);
  });
  it("links to an existing customer by email, ignoring case", () => {
    const plan = planCustomerImport([{ id: "S1", given_name: "Ann", email_address: "ANN@X.com" }], [crm({ email: "ann@x.com" })]);
    expect(plan.toLink).toEqual([{ crmId: "c1", squareId: "S1" }]);
    expect(plan.toCreate).toHaveLength(0);
  });
  it("links by phone digits regardless of formatting", () => {
    const plan = planCustomerImport([{ id: "S1", given_name: "Bo", phone_number: "+1 (774) 343-6369" }], [crm({ phone: "774-343-6369" })]);
    expect(plan.toLink).toHaveLength(1);
  });
  it("lets only one Square record claim a CRM customer", () => {
    const plan = planCustomerImport(
      [
        { id: "S1", given_name: "A", email_address: "a@x.com" },
        { id: "S2", given_name: "A2", email_address: "a@x.com" },
      ],
      [crm({ email: "a@x.com" })]
    );
    expect(plan.toLink).toHaveLength(1);
    expect(plan.toCreate).toHaveLength(1);
  });
  it("skips records with nothing usable and repeated ids", () => {
    const plan = planCustomerImport([{ id: "S1" }, { id: "S2", given_name: "Z" }, { id: "S2", given_name: "Z" }], []);
    expect(plan.skipped).toBe(1);
    expect(plan.toCreate).toHaveLength(1);
  });
  it("uses the company name when there is no person name", () => {
    expect(squareDisplayName({ company_name: "Acme HVAC" })).toBe("Acme HVAC");
  });
});

describe("safety defaults", () => {
  it("imported customers never get text consent", () => {
    expect(IMPORTED_SMS_CONSENT).toBe(false);
  });
  it("Square writes are off unless explicitly enabled", () => {
    expect(squareWritesEnabled({})).toBe(false);
    expect(squareWritesEnabled({ SQUARE_WRITES_ENABLED: "1" })).toBe(false);
    expect(squareWritesEnabled({ SQUARE_WRITES_ENABLED: "true" })).toBe(true);
  });
});
