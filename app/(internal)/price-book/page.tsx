import { supabase } from "@/lib/supabase";
import { addPriceBookItem } from "./actions";
import {
  buttonClass,
  cardClass,
  errorClass,
  headingClass,
  inputClass,
  itemSubClass,
  itemTitleClass,
  subTextClass,
} from "../ui";

function formatPrice(value: number | null) {
  if (value === null) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

const tierClass: Record<string, string> = {
  good: "bg-white/8 text-g300",
  better: "bg-blue/40 text-white",
  best: "bg-accent/20 text-accent",
};

export default async function PriceBookPage() {
  const { data: items, error } = await supabase
    .from("price_book_items")
    .select("*")
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={headingClass}>Price Book</h1>
        <p className={subTextClass}>
          Standard line items used when generating estimates, invoices, and
          proposals.
        </p>
      </div>

      <form action={addPriceBookItem} className={cardClass}>
        <input name="category" placeholder="Category" className={inputClass} />
        <select name="tier" className={inputClass} defaultValue="">
          <option value="">Tier</option>
          <option value="good">Good</option>
          <option value="better">Better</option>
          <option value="best">Best</option>
        </select>
        <input
          name="name"
          placeholder="Name"
          required
          className={`${inputClass} sm:col-span-2`}
        />
        <textarea
          name="description"
          placeholder="Description"
          className={`${inputClass} sm:col-span-2`}
        />
        <input
          name="unit_price"
          type="number"
          step="0.01"
          min="0"
          placeholder="Unit price"
          className={inputClass}
        />
        <input
          name="labor_hours"
          type="number"
          step="0.25"
          min="0"
          placeholder="Labor hours"
          className={inputClass}
        />
        <button type="submit" className={`${buttonClass} sm:col-span-2 sm:w-fit`}>
          Add Price Book Item
        </button>
      </form>

      {error && (
        <p className={errorClass}>Error loading price book: {error.message}</p>
      )}

      <div className="flex flex-col divide-y divide-white/8">
        {items?.length === 0 && <p className={subTextClass}>No price book items yet.</p>}
        {items?.map((item) => (
          <div key={item.id} className="flex items-start justify-between gap-3 py-3">
            <div>
              <div className={itemTitleClass}>{item.name}</div>
              <div className={itemSubClass}>
                {[item.category, item.labor_hours ? `${item.labor_hours} hrs labor` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
              {item.description && (
                <div className={itemSubClass}>{item.description}</div>
              )}
            </div>
            <div className="flex flex-shrink-0 flex-col items-end gap-1">
              <span className="font-mono text-sm font-medium text-white">
                {formatPrice(item.unit_price)}
              </span>
              {item.tier && (
                <span
                  className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    tierClass[item.tier] ?? "bg-white/8 text-g300"
                  }`}
                >
                  {item.tier}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
