import { describe, expect, it } from "vitest";
import { MAX_PART_ROWS, parsePartsUsed } from "../parts-used";

function form(rows: { name?: string; qty?: string; price?: string }[], count = rows.length) {
  const fd = new FormData();
  fd.set("item_count", String(count));
  rows.forEach((r, i) => {
    if (r.name !== undefined) fd.set(`name_${i}`, r.name);
    if (r.qty !== undefined) fd.set(`qty_${i}`, r.qty);
    if (r.price !== undefined) fd.set(`unit_price_${i}`, r.price);
  });
  return fd;
}

describe("parsePartsUsed", () => {
  it("reads picked parts with their quantity and price", () => {
    expect(parsePartsUsed(form([{ name: " Capacitor ", qty: "2", price: "45.5" }]))).toEqual({
      parts: [{ price_book_item_name: "Capacitor", qty: 2, unit_price: 45.5 }],
    });
  });

  it("skips the blank 'Select a part' row", () => {
    expect(parsePartsUsed(form([{ name: "", qty: "1" }, { name: "Contactor", qty: "1" }]))).toEqual({
      parts: [{ price_book_item_name: "Contactor", qty: 1, unit_price: null }],
    });
  });

  it("refuses zero, negative, blank or junk quantities on a picked part", () => {
    for (const qty of ["0", "-1", "-0.5", "", "abc", "Infinity", "NaN"]) {
      const result = parsePartsUsed(form([{ name: "Capacitor", qty }]));
      expect(result.error, `qty ${JSON.stringify(qty)}`).toMatch(/Capacitor/);
      expect(result.parts).toBeUndefined();
    }
    // A missing qty field is refused too.
    expect(parsePartsUsed(form([{ name: "Capacitor" }])).error).toBeDefined();
  });

  it("refuses an absurd quantity", () => {
    expect(parsePartsUsed(form([{ name: "Capacitor", qty: "1000000" }])).error).toBeDefined();
  });

  it("refuses the whole save if any row is bad, so nothing half-saves", () => {
    const result = parsePartsUsed(form([{ name: "Contactor", qty: "1" }, { name: "Capacitor", qty: "-3" }]));
    expect(result.error).toBeDefined();
  });

  it("drops a negative or junk price so the server uses the price book", () => {
    expect(parsePartsUsed(form([{ name: "A", qty: "1", price: "-10" }])).parts?.[0].unit_price).toBeNull();
    expect(parsePartsUsed(form([{ name: "A", qty: "1", price: "abc" }])).parts?.[0].unit_price).toBeNull();
    expect(parsePartsUsed(form([{ name: "A", qty: "1", price: "" }])).parts?.[0].unit_price).toBeNull();
    expect(parsePartsUsed(form([{ name: "A", qty: "1", price: "0" }])).parts?.[0].unit_price).toBe(0);
  });

  it("caps the row count from the form", () => {
    const rows = Array.from({ length: MAX_PART_ROWS + 5 }, (_, i) => ({ name: `Part ${i}`, qty: "1" }));
    expect(parsePartsUsed(form(rows)).parts).toHaveLength(MAX_PART_ROWS);
    expect(parsePartsUsed(form([], -4))).toEqual({ parts: [] });
    expect(parsePartsUsed(form([], Number.NaN))).toEqual({ parts: [] });
  });
});
