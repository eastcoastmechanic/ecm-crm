import { supabase } from "@/lib/supabase";
import { addPriceBookItem } from "./actions";

const inputClass =
  "rounded border border-black/10 px-3 py-2 text-sm dark:border-white/10 dark:bg-transparent";

function formatPrice(value: number | null) {
  if (value === null) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

export default async function PriceBookPage() {
  const { data: items, error } = await supabase
    .from("price_book_items")
    .select("*")
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Price Book</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Standard line items used when generating estimates, invoices, and
          proposals.
        </p>
      </div>

      <form
        action={addPriceBookItem}
        className="grid gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10 sm:grid-cols-2"
      >
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
        <button
          type="submit"
          className="rounded bg-foreground px-4 py-2 text-sm text-background sm:col-span-2 sm:w-fit"
        >
          Add Price Book Item
        </button>
      </form>

      {error && (
        <p className="text-sm text-red-600">
          Error loading price book: {error.message}
        </p>
      )}

      <div className="flex flex-col divide-y divide-black/10 dark:divide-white/10">
        {items?.length === 0 && (
          <p className="text-sm text-black/60 dark:text-white/60">
            No price book items yet.
          </p>
        )}
        {items?.map((item) => (
          <div key={item.id} className="py-3">
            <div className="font-medium">
              {item.name}
              {item.tier ? ` — ${item.tier}` : ""}
            </div>
            <div className="text-sm text-black/60 dark:text-white/60">
              {[
                item.category,
                formatPrice(item.unit_price),
                item.labor_hours ? `${item.labor_hours} hrs labor` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
            {item.description && (
              <div className="text-sm text-black/60 dark:text-white/60">
                {item.description}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
