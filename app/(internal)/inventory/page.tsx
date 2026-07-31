import { supabase } from "@/lib/supabase";
import { fetchAllPriceBookItems } from "@/lib/price-book";
import { addInventoryItem, adjustInventoryQty } from "./actions";
import SubmitButton from "../SubmitButton";
import {
  buttonClass,
  cardClass,
  headingClass,
  inputClass,
  itemSubClass,
  itemTitleClass,
  subTextClass,
} from "../ui";

export const dynamic = "force-dynamic";

type InventoryItem = {
  id: string;
  qty_on_hand: number;
  reorder_threshold: number | null;
  price_book_items: { name: string; category: string | null }[] | null;
};

export default async function InventoryPage() {
  const [{ data: items, error }, priceBookItems] = await Promise.all([
    supabase
      .from("inventory_items")
      .select("id, qty_on_hand, reorder_threshold, price_book_items(name, category)")
      .order("updated_at", { ascending: false }),
    fetchAllPriceBookItems<{ id: string; name: string; category: string | null }>(
      supabase,
      "id, name, category"
    ),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={headingClass}>Truck Inventory</h1>
        <p className={subTextClass}>
          What&apos;s actually on hand, tied to real price book items.
        </p>
      </div>

      <form action={addInventoryItem} className={cardClass}>
        <label className="flex flex-col gap-1 text-xs text-g300 sm:col-span-2">
          Part
          <select name="price_book_item_id" required className={inputClass}>
            <option value="">Select a price book item…</option>
            {priceBookItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.category ? `${item.category} — ` : ""}
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-g300">
          Qty on hand
          <input
            name="qty_on_hand"
            type="number"
            step="1"
            min="0"
            defaultValue={0}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-g300">
          Reorder threshold
          <input name="reorder_threshold" type="number" step="1" min="0" className={inputClass} />
        </label>
        <SubmitButton className={`${buttonClass} sm:col-span-2 sm:w-fit`}>Add to Inventory</SubmitButton>
      </form>

      {error && <p className={itemSubClass}>Error loading inventory: {error.message}</p>}

      <div className="flex flex-col divide-y divide-white/8">
        {(items ?? []).length === 0 && <p className={subTextClass}>No inventory tracked yet.</p>}
        {((items ?? []) as InventoryItem[]).map((item) => {
          const priceBookItem = item.price_book_items?.[0];
          const low =
            item.reorder_threshold !== null && item.qty_on_hand <= item.reorder_threshold;
          return (
            <div key={item.id} className="flex items-center justify-between gap-4 py-3">
              <div>
                <div className={itemTitleClass}>
                  {priceBookItem?.name ?? "Unknown item"}
                  {low && (
                    <span className="ml-2 rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                      Reorder
                    </span>
                  )}
                </div>
                <div className={itemSubClass}>
                  {priceBookItem?.category ?? ""}
                  {item.reorder_threshold !== null ? ` · Reorder at ${item.reorder_threshold}` : ""}
                </div>
              </div>
              <form action={adjustInventoryQty} className="flex items-center gap-2">
                <input type="hidden" name="id" value={item.id} />
                <input
                  type="number"
                  name="qty_on_hand"
                  step="1"
                  min="0"
                  defaultValue={item.qty_on_hand}
                  aria-label="Quantity on hand"
                  className={`${inputClass} w-20 text-right`}
                />
                <SubmitButton className={buttonClass}>Save</SubmitButton>
              </form>
            </div>
          );
        })}
      </div>
    </div>
  );
}
