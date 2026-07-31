"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { inputClass, itemSubClass, itemTitleClass, subTextClass } from "../ui";

type Diagnostic = {
  id: string;
  created_at: string;
  equipment: {
    type: string | null;
    brand: string | null;
    model: string | null;
    properties: { address: string | null; customers: { name: string | null } | null } | null;
  } | null;
  jobs: {
    customers: { name: string | null } | null;
    properties: { address: string | null } | null;
  } | null;
};

export default function DiagnosticsList({ diagnostics }: { diagnostics: Diagnostic[] }) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return diagnostics;
    return diagnostics.filter((d) => {
      const customerName = d.equipment?.properties?.customers?.name ?? d.jobs?.customers?.name;
      const address = d.equipment?.properties?.address ?? d.jobs?.properties?.address;
      return [d.equipment?.type, d.equipment?.brand, d.equipment?.model, customerName, address]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(query));
    });
  }, [diagnostics, search]);

  return (
    <div className="flex flex-col gap-4">
      <input
        type="text"
        placeholder="Search diagnostics…"
        aria-label="Search diagnostics"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className={inputClass}
      />

      <div className="flex flex-col divide-y divide-white/8">
        {filtered.length === 0 && <p className={subTextClass}>No diagnostics match.</p>}
        {filtered.map((d) => {
          const customerName = d.equipment?.properties?.customers?.name ?? d.jobs?.customers?.name;
          const address = d.equipment?.properties?.address ?? d.jobs?.properties?.address;
          return (
            <Link
              key={d.id}
              href={`/diagnostics/${d.id}`}
              className="flex items-center justify-between gap-4 py-3 hover:bg-white/3"
            >
              <div>
                <div className={itemTitleClass}>
                  {d.equipment?.type ?? "Diagnostic"}
                  {d.equipment?.brand ? ` — ${d.equipment.brand}` : ""}
                  {d.equipment?.model ? ` ${d.equipment.model}` : ""}
                </div>
                <div className={itemSubClass}>
                  {customerName ?? "No customer assigned yet"}
                  {address ? ` · ${address}` : ""}
                  {" · "}
                  {new Date(d.created_at).toLocaleDateString()}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
