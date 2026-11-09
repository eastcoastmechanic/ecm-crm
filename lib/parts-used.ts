// Reads the "Parts used" form on a service report. Pure, so it is easy to test.

export type PartUsed = { price_book_item_name: string; qty: number; unit_price: number | null };

/** More rows than any real service call, so a forged form can't make the server loop forever. */
export const MAX_PART_ROWS = 100;
/** A quantity above this is a typo (or a forged form), not a real part count. */
export const MAX_PART_QTY = 10000;

/**
 * Rows with no part picked are skipped (the blank "Select a part" row). A picked
 * part must have a quantity above zero: zero or less would put stock back into
 * inventory or bill a negative line, so the whole save is refused with a reason.
 * A submitted unit price that isn't a number of zero or more is dropped, so the
 * server falls back to the price book.
 */
export function parsePartsUsed(formData: FormData): { parts: PartUsed[]; error?: undefined } | { error: string; parts?: undefined } {
  const count = Math.min(Math.max(Math.trunc(Number(formData.get("item_count")) || 0), 0), MAX_PART_ROWS);
  const parts: PartUsed[] = [];
  for (let i = 0; i < count; i++) {
    const rawName = formData.get(`name_${i}`);
    const name = typeof rawName === "string" ? rawName.trim() : "";
    if (!name) continue;
    const rawQty = formData.get(`qty_${i}`);
    const qty = typeof rawQty === "string" && rawQty.trim() !== "" ? Number(rawQty) : NaN;
    if (!Number.isFinite(qty) || qty <= 0) return { error: `Enter a quantity of 1 or more for ${name}, or remove that row.` };
    if (qty > MAX_PART_QTY) return { error: `The quantity for ${name} looks wrong. Check it and save again.` };
    const rawPrice = formData.get(`unit_price_${i}`);
    const price = typeof rawPrice === "string" && rawPrice.trim() !== "" ? Number(rawPrice) : NaN;
    parts.push({
      price_book_item_name: name,
      qty,
      unit_price: Number.isFinite(price) && price >= 0 ? price : null,
    });
  }
  return { parts };
}
