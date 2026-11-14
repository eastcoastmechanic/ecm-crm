import { describe, expect, it } from "vitest";
import { nameKey, planCatalogImport, squarePriceDollars, type SquareCatalogObject } from "../square-catalog-rules";

type Var = { id: string; name?: string; cents?: number; currency?: string; variable?: boolean; deleted?: boolean };

function item(id: string, name: string, vars: Var[], extra: Partial<NonNullable<SquareCatalogObject["item_data"]>> = {}): SquareCatalogObject {
  return {
    type: "ITEM",
    id,
    item_data: {
      name,
      ...extra,
      variations: vars.map((v) => ({
        id: v.id,
        is_deleted: v.deleted,
        item_variation_data: {
          name: v.name ?? "Regular",
          pricing_type: v.variable ? "VARIABLE_PRICING" : "FIXED_PRICING",
          price_money: v.cents === undefined ? undefined : { amount: v.cents, currency: v.currency ?? "USD" },
        },
      })),
    },
  };
}

const category = (id: string, name: string): SquareCatalogObject => ({ type: "CATEGORY", id, category_data: { name } });

describe("squarePriceDollars", () => {
  it("turns cents into dollars", () => {
    expect(squarePriceDollars({ pricing_type: "FIXED_PRICING", price_money: { amount: 12550, currency: "USD" } })).toBe(125.5);
  });
  it("never invents a price for variable or missing prices", () => {
    expect(squarePriceDollars({ pricing_type: "VARIABLE_PRICING" })).toBeNull();
    expect(squarePriceDollars({ pricing_type: "FIXED_PRICING" })).toBeNull();
    expect(squarePriceDollars(null)).toBeNull();
  });
  it("flags other currencies", () => {
    expect(squarePriceDollars({ pricing_type: "FIXED_PRICING", price_money: { amount: 100, currency: "CAD" } })).toBe("currency");
  });
});

describe("nameKey", () => {
  it("ignores case and extra spaces", () => {
    expect(nameKey("  Drain   Line FLUSH ")).toBe(nameKey("drain line flush"));
  });
});

describe("planCatalogImport", () => {
  it("uses the item name alone for a single variation, with category and description", () => {
    const plan = planCatalogImport(
      [
        category("C1", "Service"),
        item("I1", "Diagnostic Fee", [{ id: "V1", cents: 12500 }], {
          categories: [{ id: "C1" }],
          description_plaintext: "First hour on site",
        }),
      ],
      []
    );
    expect(plan.toCreate).toEqual([
      { square_catalog_object_id: "V1", name: "Diagnostic Fee", category: "Service", description: "First hour on site", unit_price: 125 },
    ]);
    expect(plan.squareItems).toBe(1);
    expect(plan.squareVariations).toBe(1);
  });

  it("names each variation 'Item — Variation' when there is more than one", () => {
    const plan = planCatalogImport(
      [item("I1", "Filter", [{ id: "V1", name: "16x25", cents: 2000 }, { id: "V2", name: "20x25", cents: 2200 }])],
      []
    );
    expect(plan.toCreate.map((r) => [r.name, r.unit_price, r.category])).toEqual([
      ["Filter — 16x25", 20, null],
      ["Filter — 20x25", 22, null],
    ]);
  });

  it("skips rows already there by Square id or by name, never overwriting", () => {
    const plan = planCatalogImport(
      [
        item("I1", "Diagnostic Fee", [{ id: "V1", cents: 12500 }]),
        item("I2", "Drain Line Flush", [{ id: "V2", cents: 9900 }]),
        item("I3", "New Thing", [{ id: "V3", cents: 100 }]),
      ],
      [
        { name: "Renamed in CRM", square_catalog_object_id: "V1" },
        { name: "  drain line   FLUSH", square_catalog_object_id: null },
      ]
    );
    expect(plan.alreadyThere).toBe(2);
    expect(plan.toCreate.map((r) => r.name)).toEqual(["New Thing"]);
  });

  it("brings variable-price items in with no price, never a made-up one", () => {
    const plan = planCatalogImport([item("I1", "Custom Job", [{ id: "V1", variable: true }])], []);
    expect(plan.toCreate[0].unit_price).toBeNull();
    expect(plan.noPrice).toBe(1);
  });

  it("skips archived, deleted, nameless, non-USD and duplicate-name rows with a reason", () => {
    const plan = planCatalogImport(
      [
        item("I1", "Old", [{ id: "V1", cents: 100 }], { is_archived: true }),
        { ...item("I2", "Gone", [{ id: "V2", cents: 100 }]), is_deleted: true },
        item("I3", "Half", [{ id: "V3", name: "A", cents: 100 }, { id: "V4", name: "B", cents: 100, deleted: true }]),
        item("I4", "", [{ id: "V5", name: "", cents: 100 }]),
        item("I5", "Loonie", [{ id: "V6", cents: 100, currency: "CAD" }]),
        item("I6", "Twin", [{ id: "V7", cents: 100 }]),
        item("I7", "twin ", [{ id: "V8", cents: 200 }]),
      ],
      []
    );
    // A deleted variation doesn't count, so "Half" has one variation and keeps its plain name.
    expect(plan.toCreate.map((r) => r.name)).toEqual(["Half", "Twin"]);
    expect(plan.skipped).toEqual(
      expect.arrayContaining([
        { reason: "archived in Square", count: 1 },
        { reason: "no name in Square", count: 1 },
        { reason: "not in US dollars", count: 1 },
        { reason: "same name twice in Square", count: 1 },
      ])
    );
    expect(plan.squareItems).toBe(6);
  });

  it("reads the legacy category_id when categories is empty", () => {
    const plan = planCatalogImport(
      [category("C9", "Parts"), item("I1", "Capacitor", [{ id: "V1", cents: 4500 }], { category_id: "C9" })],
      []
    );
    expect(plan.toCreate[0].category).toBe("Parts");
  });
});
