"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { inputClass, itemSubClass, itemTitleClass, subTextClass } from "../../ui";

type Report = {
  id: string;
  created_at: string;
  system_type: string | null;
  brand: string | null;
  model: string | null;
  customers: { name: string | null } | null;
  properties: { address: string | null } | null;
};

export default function InstallReportsList({ reports }: { reports: Report[] }) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return reports;
    return reports.filter((r) =>
      [r.system_type, r.brand, r.model, r.customers?.name, r.properties?.address]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(query))
    );
  }, [reports, search]);

  return (
    <div className="flex flex-col gap-4">
      <input
        type="text"
        placeholder="Search install reports…"
        aria-label="Search install reports"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className={inputClass}
      />

      <div className="flex flex-col divide-y divide-white/8">
        {filtered.length === 0 && <p className={subTextClass}>No install reports match.</p>}
        {filtered.map((r) => (
          <Link
            key={r.id}
            href={`/tech-hub/install-report/${r.id}`}
            className="flex items-center justify-between gap-4 py-3 hover:bg-white/3"
          >
            <div>
              <div className={itemTitleClass}>
                {r.system_type ?? "Install Report"}
                {r.brand ? ` — ${r.brand}` : ""}
                {r.model ? ` ${r.model}` : ""}
              </div>
              <div className={itemSubClass}>
                {r.customers?.name ?? "No customer assigned"}
                {r.properties?.address ? ` · ${r.properties.address}` : ""}
                {" · "}
                {new Date(r.created_at).toLocaleDateString()}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
