// Pure rules for copying the Square catalog into the CRM price book. No database or network imports,
// so they can be tested. Nothing here invents a price: a row gets Square's own price, or no price.

type SquareMoney = { amount?: number | null; currency?: string | null };

export type SquareCatalogObject = {
  type?: string;
  id?: string;
  is_deleted?: boolean;
  category_data?: { name?: string | null } | null;
  item_data?: {
    name?: string | null;
    description?: string | null;
    description_plaintext?: string | null;
    is_archived?: boolean | null;
    category_id?: string | null;
    categories?: Array<{ id?: string | null }> | null;
    reporting_category?: { id?: string | null } | null;
    variations?: Array<{
      id?: string;
      is_deleted?: boolean;
      item_variation_data?: {
        name?: string | null;
        pricing_type?: string | null;
        price_money?: SquareMoney | null;
      } | null;
    }> | null;
  } | null;
};

export type ExistingPriceBookRow = {
  name: string | null;
  square_catalog_object_id?: string | null;
};

export type NewPriceBookRow = {
  /** The Square item variation id. One price book row per variation. */
  square_catalog_object_id: string;
  name: string;
  category: string | null;
  description: string | null;
  /** Dollars, straight from Square. Null when Square has no set price (variable price). */
  unit_price: number | null;
};

export type SkipReason =
  | "archived in Square"
  | "no name in Square"
  | "not in US dollars"
  | "same name twice in Square";

export type CatalogImportPlan = {
  /** Square items read (not counting deleted ones). */
  squareItems: number;
  /** Square variations considered (one candidate row each). */
  squareVariations: number;
  toCreate: NewPriceBookRow[];
  /** Of toCreate, how many come in with no price (variable price in Square). */
  noPrice: number;
  /** Already in the price book, by Square id or by name. Never overwritten. */
  alreadyThere: number;
  skipped: { reason: SkipReason; count: number }[];
};

/** Lower case, trimmed, runs of spaces collapsed: "  Drain  Line Flush" matches "drain line flush". */
export function nameKey(name: string | null | undefined): string {
  return (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function clean(s: string | null | undefined): string {
  return (s ?? "").trim().replace(/\s+/g, " ");
}

/**
 * Square price in cents -> dollars. Null when Square has no usable fixed price; the caller never
 * makes one up. Returns "currency" when the price is in a currency other than USD.
 */
export function squarePriceDollars(
  v: { pricing_type?: string | null; price_money?: SquareMoney | null } | null | undefined
): number | null | "currency" {
  if (!v || v.pricing_type === "VARIABLE_PRICING") return null;
  const amount = v.price_money?.amount;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) return null;
  const currency = v.price_money?.currency;
  if (currency && currency !== "USD") return "currency";
  return Math.round(amount) / 100;
}

function categoryIdOf(item: NonNullable<SquareCatalogObject["item_data"]>): string | null {
  return item.categories?.find((c) => c?.id)?.id ?? item.category_id ?? item.reporting_category?.id ?? null;
}

/**
 * Plans the import. Each live variation of a live, unarchived Square item becomes one price book
 * row named "Item — Variation" when the item has more than one variation, else just "Item".
 * Already there = same Square variation id, or the same name (case and spacing ignored) anywhere
 * in the price book. Existing rows are never changed.
 */
export function planCatalogImport(
  objects: SquareCatalogObject[],
  existing: ExistingPriceBookRow[]
): CatalogImportPlan {
  const categoryNames = new Map<string, string>();
  for (const o of objects) {
    if (o.type === "CATEGORY" && o.id && !o.is_deleted) {
      const name = clean(o.category_data?.name);
      if (name) categoryNames.set(o.id, name);
    }
  }

  const knownIds = new Set(existing.map((r) => r.square_catalog_object_id).filter(Boolean) as string[]);
  const knownNames = new Set(existing.map((r) => nameKey(r.name)).filter(Boolean));

  const skipCounts = new Map<SkipReason, number>();
  const skip = (reason: SkipReason) => skipCounts.set(reason, (skipCounts.get(reason) ?? 0) + 1);

  const plan: CatalogImportPlan = {
    squareItems: 0,
    squareVariations: 0,
    toCreate: [],
    noPrice: 0,
    alreadyThere: 0,
    skipped: [],
  };
  const seenVariation = new Set<string>();
  const plannedNames = new Set<string>();

  for (const o of objects) {
    if (o.type !== "ITEM" || o.is_deleted || !o.item_data) continue;
    plan.squareItems += 1;
    const item = o.item_data;
    const variations = (item.variations ?? []).filter(
      (v) => v?.id && !v.is_deleted && !seenVariation.has(v.id)
    );
    const itemName = clean(item.name);
    const catId = categoryIdOf(item);
    const category = catId ? categoryNames.get(catId) ?? null : null;
    const description = clean(item.description_plaintext ?? item.description) || null;

    for (const v of variations) {
      const id = v.id as string;
      seenVariation.add(id);
      plan.squareVariations += 1;

      if (item.is_archived) {
        skip("archived in Square");
        continue;
      }
      const varName = clean(v.item_variation_data?.name);
      const name =
        variations.length > 1 && itemName && varName ? `${itemName} — ${varName}` : itemName || varName;
      if (!name) {
        skip("no name in Square");
        continue;
      }
      if (knownIds.has(id) || knownNames.has(nameKey(name))) {
        plan.alreadyThere += 1;
        continue;
      }
      const price = squarePriceDollars(v.item_variation_data);
      if (price === "currency") {
        skip("not in US dollars");
        continue;
      }
      if (plannedNames.has(nameKey(name))) {
        skip("same name twice in Square");
        continue;
      }
      plannedNames.add(nameKey(name));
      plan.toCreate.push({ square_catalog_object_id: id, name, category, description, unit_price: price });
      if (price === null) plan.noPrice += 1;
    }
  }

  plan.skipped = Array.from(skipCounts, ([reason, count]) => ({ reason, count }));
  return plan;
}
