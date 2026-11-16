import { describe, expect, it } from "vitest";
import {
  afterImport,
  appendSquareNote,
  hasPropertyAt,
  normalizeAddress,
  planSquareFill,
  squareAddressText,
  type FillCrmCust,
} from "../square-fill-rules";
import { planCustomerImport } from "../square-import-rules";

const crm = (o: Partial<FillCrmCust> = {}): FillCrmCust => ({
  id: "c1",
  name: "Ann Lee",
  square_customer_id: "S1",
  email: null,
  phone: null,
  company_name: null,
  billing_address: null,
  notes: null,
  ...o,
});

const addr = {
  address_line_1: "12 Main Street",
  address_line_2: "Unit 2",
  locality: "Plymouth",
  administrative_district_level_1: "MA",
  postal_code: "02360",
};

describe("squareAddressText", () => {
  it("joins the parts Square has", () => {
    expect(squareAddressText(addr)).toBe("12 Main Street, Unit 2, Plymouth, MA 02360");
    expect(squareAddressText({ address_line_1: " 5 Elm Rd ", locality: "Bourne" })).toBe("5 Elm Rd, Bourne");
  });
  it("is null with no street line", () => {
    expect(squareAddressText(undefined)).toBeNull();
    expect(squareAddressText({ locality: "Plymouth", postal_code: "02360" })).toBeNull();
  });
});

describe("hasPropertyAt", () => {
  it("matches the same street however the city and suffix are written", () => {
    expect(normalizeAddress("12 Main Street.")).toBe("12 main st");
    expect(hasPropertyAt(["12 Main St, Plymouth MA"], addr)).toBe(true);
    expect(hasPropertyAt(["12 main st"], addr)).toBe(true);
  });
  it("does not match a different house number", () => {
    expect(hasPropertyAt(["112 Main St, Plymouth"], addr)).toBe(false);
    expect(hasPropertyAt(["12 Maine St"], addr)).toBe(false);
    expect(hasPropertyAt([], addr)).toBe(false);
  });
});

describe("appendSquareNote", () => {
  it("uses the Square note when the CRM has none", () => {
    expect(appendSquareNote(null, "Gate code 1234")).toBe("Gate code 1234");
    expect(appendSquareNote("  ", "Gate code 1234")).toBe("Gate code 1234");
  });
  it("adds it under the existing notes", () => {
    expect(appendSquareNote("Dog in yard", "Gate code 1234")).toBe("Dog in yard\n\nFrom Square: Gate code 1234");
  });
  it("does nothing when the note is already there or empty", () => {
    expect(appendSquareNote("Dog in yard\n\nFrom Square: Gate  code 1234", "gate code 1234")).toBeNull();
    expect(appendSquareNote("Dog", "  ")).toBeNull();
    expect(appendSquareNote("Dog", undefined)).toBeNull();
  });
});

describe("planSquareFill", () => {
  it("fills only empty fields, adds the property and the note", () => {
    const plan = planSquareFill(
      [{ id: "S1", email_address: "ann@x.com", phone_number: "+17745550100", company_name: "Lee Co", address: addr, note: "Side door" }],
      [crm({ email: "keep@x.com" })],
      []
    );
    expect(plan.fills).toEqual([
      {
        crmId: "c1",
        fields: {
          phone: "+17745550100",
          company_name: "Lee Co",
          billing_address: "12 Main Street, Unit 2, Plymouth, MA 02360",
        },
        notes: { before: null, after: "Side door" },
        propertyAddress: "12 Main Street, Unit 2, Plymouth, MA 02360",
      },
    ]);
    expect(plan).toMatchObject({ fieldsToFill: 1, notesToAdd: 1, propertiesToAdd: 1 });
  });
  it("never overwrites a filled CRM field", () => {
    const full = crm({ email: "a@x.com", phone: "1", company_name: "C", billing_address: "B", notes: "Side door" });
    const plan = planSquareFill(
      [{ id: "S1", email_address: "z@x.com", phone_number: "2", company_name: "Z", address: addr, note: "Side door" }],
      [full],
      [{ customer_id: "c1", address: "12 Main St, Plymouth" }]
    );
    expect(plan.fills).toEqual([]);
  });
  it("skips a company name that is just the customer's name", () => {
    const plan = planSquareFill([{ id: "S1", company_name: "ann lee" }], [crm()], []);
    expect(plan.fills).toEqual([]);
  });
  it("only looks at this customer's properties", () => {
    const plan = planSquareFill([{ id: "S1", address: addr }], [crm({ billing_address: "x" })], [
      { customer_id: "other", address: "12 Main St" },
    ]);
    expect(plan.propertiesToAdd).toBe(1);
  });
  it("ignores customers with no Square link or a missing Square record", () => {
    const plan = planSquareFill([{ id: "S1", note: "n" }], [crm({ square_customer_id: null }), crm({ id: "c2", square_customer_id: "S9" })], []);
    expect(plan.fills).toEqual([]);
  });
  it("is idempotent: applying the plan leaves nothing to do", () => {
    const square = [{ id: "S1", phone_number: "5", address: addr, note: "Side door" }];
    const first = planSquareFill(square, [crm()], []);
    const f = first.fills[0];
    const after = crm({ ...f.fields, notes: f.notes?.after ?? null });
    expect(planSquareFill(square, [after], [{ customer_id: "c1", address: f.propertyAddress ?? null }]).fills).toEqual([]);
  });
});

describe("afterImport (dry run view)", () => {
  it("counts fills for customers about to be linked or created", () => {
    const square = [
      { id: "S1", given_name: "Ann", email_address: "ann@x.com", address: addr },
      { id: "S2", given_name: "Bo", note: "Cash only" },
    ];
    const existing = crm({ id: "c1", square_customer_id: null, email: "ann@x.com" });
    const plan = planCustomerImport(square, [existing]);
    const view = afterImport([existing], plan);
    expect(view.map((c) => c.square_customer_id)).toEqual(["S1", "S2"]);
    const fill = planSquareFill(square, view, []);
    expect(fill).toMatchObject({ fieldsToFill: 1, notesToAdd: 1, propertiesToAdd: 1 });
  });
});
