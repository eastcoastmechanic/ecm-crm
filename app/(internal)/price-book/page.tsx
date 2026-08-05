import { headers } from "next/headers";
import { supabase } from "@/lib/supabase";
import { fetchAllPriceBookItems } from "@/lib/price-book";
import { addPriceBookItem } from "./actions";
import PriceBookList, { type PriceBookItem } from "./PriceBookList";
import SubmitButton from "../SubmitButton";
import { buttonClass, cardClass, headingClass, inputClass, subTextClass } from "../ui";

export const dynamic = "force-dynamic";

export default async function PriceBookPage() {
  const canSeeProfit = (await headers()).get("x-staff-role") === "owner";
  const items = await fetchAllPriceBookItems<PriceBookItem>(supabase);

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
        <label className="flex flex-col gap-1 text-xs text-g300">
          Category
          <input name="category" placeholder="Category" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-g300">
          Tier
          <select name="tier" className={inputClass} defaultValue="">
            <option value="">Tier</option>
            <option value="good">Good</option>
            <option value="better">Better</option>
            <option value="best">Best</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-g300 sm:col-span-2">
          Name
          <input name="name" placeholder="Name" required className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-g300 sm:col-span-2">
          Description
          <textarea name="description" placeholder="Description" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-g300">
          Unit price
          <input
            name="unit_price"
            type="number"
            step="0.01"
            min="0"
            placeholder="Unit price"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-g300">
          Labor hours
          <input
            name="labor_hours"
            type="number"
            step="0.25"
            min="0"
            placeholder="Labor hours"
            className={inputClass}
          />
        </label>
        {canSeeProfit && (
          <label className="flex flex-col gap-1 text-xs text-gold" title="Internal only — never shown to the customer">
            Cost
            <input
              name="unit_cost"
              type="number"
              step="0.01"
              min="0"
              placeholder="Wholesale cost"
              className={inputClass}
            />
          </label>
        )}
        <SubmitButton className={`${buttonClass} sm:col-span-2 sm:w-fit`}>Add Price Book Item</SubmitButton>
      </form>

      <PriceBookList items={items} canSeeProfit={canSeeProfit} />
    </div>
  );
}
