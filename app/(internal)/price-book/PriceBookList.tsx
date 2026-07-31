"use client";

import { useMemo, useState } from "react";
import { inputClass, itemSubClass, itemTitleClass, subTextClass } from "../ui";

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

export default function PriceBookList({ items }: { items: PriceBookItem[] }) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) =>
      [item.name, item.category, item.description, item.tier]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(query))
    );
  }, [items, search]);

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
        {filtered.map((item) => (
          <div key={item.id} className="flex items-start justify-between gap-3 py-3">
            <div>
              <div className={itemTitleClass}>{item.name}</div>
              <div className={itemSubClass}>
                {[item.category, item.labor_hours ? `${item.labor_hours} hrs labor` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
              {item.description && <div className={itemSubClass}>{item.description}</div>}
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
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
