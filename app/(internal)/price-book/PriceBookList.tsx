"use client";

import { useMemo, useState } from "react";
import { updatePriceBookItem, deletePriceBookItem } from "./actions";
import SubmitButton from "../SubmitButton";
import { buttonClass, buttonSecondaryClass, errorClass, inputClass, itemSubClass, itemTitleClass, subTextClass } from "../ui";

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

export type PriceBookItem = {
  id: string;
  category: string | null;
  tier: string | null;
  name: string;
  description: string | null;
  unit_price: number | null;
  labor_hours: number | null;
};

function EditPriceBookItemForm({ item, onDone }: { item: PriceBookItem; onDone: () => void }) {
  return (
    <form
      action={async (formData) => {
        await updatePriceBookItem(formData);
        onDone();
      }}
      className="grid gap-3 rounded-xl border border-white/8 bg-white/3 p-4 sm:grid-cols-2"
    >
      <input type="hidden" name="id" value={item.id} />
      <label className="flex flex-col gap-1 text-xs text-g300">
        Category
        <input name="category" defaultValue={item.category ?? ""} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-g300">
        Tier
        <select name="tier" defaultValue={item.tier ?? ""} className={inputClass}>
          <option value="">Tier</option>
          <option value="good">Good</option>
          <option value="better">Better</option>
          <option value="best">Best</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-g300 sm:col-span-2">
        Name
        <input name="name" required defaultValue={item.name} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-g300 sm:col-span-2">
        Description
        <textarea name="description" defaultValue={item.description ?? ""} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-g300">
        Unit price
        <input
          name="unit_price"
          type="number"
          step="0.01"
          min="0"
          defaultValue={item.unit_price ?? ""}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-g300">
        Labor hours
        <input
          name="labor_hours"
          type="number"
          step="0.1"
          min="0"
          defaultValue={item.labor_hours ?? ""}
          className={inputClass}
        />
      </label>
      <div className="flex items-center gap-2 sm:col-span-2">
        <SubmitButton className={`${buttonClass} w-fit`} pendingText="Saving…">
          Save
        </SubmitButton>
        <button type="button" onClick={onDone} className={`${subTextClass} underline`}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function PriceBookList({ items }: { items: PriceBookItem[] }) {
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) =>
      [item.name, item.category, item.description, item.tier]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(query))
    );
  }, [items, search]);

  async function handleDelete(item: PriceBookItem) {
    if (!window.confirm(`Delete "${item.name}"? This cannot be undone.`)) return;

    setErrors((prev) => ({ ...prev, [item.id]: "" }));
    setDeletingId(item.id);
    try {
      const result = await deletePriceBookItem(item.id);
      if (result.error) {
        setErrors((prev) => ({ ...prev, [item.id]: result.error! }));
      }
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <input
        type="text"
        placeholder="Search price book…"
        aria-label="Search price book"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className={inputClass}
      />

      <div className="flex flex-col divide-y divide-white/8">
        {filtered.length === 0 && <p className={subTextClass}>No price book items match.</p>}
        {filtered.map((item) =>
          editingId === item.id ? (
            <div key={item.id} className="py-3">
              <EditPriceBookItemForm item={item} onDone={() => setEditingId(null)} />
            </div>
          ) : (
            <div key={item.id} className="flex items-start justify-between gap-3 py-3">
              <div>
                <div className={itemTitleClass}>{item.name}</div>
                <div className={itemSubClass}>
                  {[item.category, item.labor_hours ? `${item.labor_hours} hrs labor` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
                {item.description && <div className={itemSubClass}>{item.description}</div>}
                {errors[item.id] && <p className={`mt-1 ${errorClass}`}>{errors[item.id]}</p>}
              </div>
              <div className="flex flex-shrink-0 flex-col items-end gap-1">
                <span className="font-mono text-sm font-medium text-white">{formatPrice(item.unit_price)}</span>
                {item.tier && (
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      tierClass[item.tier] ?? "bg-white/8 text-g300"
                    }`}
                  >
                    {item.tier}
                  </span>
                )}
                <div className="mt-1 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingId(item.id)}
                    className={`${buttonSecondaryClass} !px-2 !py-1`}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(item)}
                    disabled={deletingId === item.id}
                    title="Delete item"
                    className="rounded-lg p-1.5 text-base opacity-60 transition-opacity hover:opacity-100 disabled:opacity-30"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}
