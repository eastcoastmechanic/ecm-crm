import Link from "next/link";
import { listChecklists } from "@/lib/pm/db";
import { buttonClass, errorClass, headingClass, itemSubClass, itemTitleClass, subTextClass } from "../ui";

export const dynamic = "force-dynamic";

export default async function PmListPage() {
  const { rows, error } = await listChecklists();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className={headingClass}>Maintenance</h1>
          <p className={subTextClass}>Preventive maintenance checklists for a maintenance job and a piece of equipment.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/pm/templates" className="text-sm text-g300 underline">
            Edit templates
          </Link>
          <Link href="/pm/new" className={buttonClass}>
            New checklist
          </Link>
        </div>
      </div>
      {error && (
        <p className={errorClass}>
          {error}. Apply db/migrations/0048_preventive_maintenance.sql if this is a missing-table error.
        </p>
      )}
      <div className="flex flex-col divide-y divide-white/8">
        {rows.length === 0 && !error && <p className={subTextClass}>No checklists yet.</p>}
        {rows.map((row) => (
          <Link key={row.id} href={`/pm/${row.id}`} className="flex items-start justify-between gap-3 py-3">
            <div>
              <div className={itemTitleClass}>
                {row.customer_name}
                {row.property_address ? ` — ${row.property_address}` : ""}
              </div>
              <div className={itemSubClass}>
                {row.equipment_label}
                {row.doc_number ? ` · ${row.doc_number}` : ""}
                {row.tech_name ? ` · ${row.tech_name}` : ""}
              </div>
            </div>
            <span className="shrink-0 text-xs font-bold uppercase tracking-wide text-g300">
              {row.status === "complete" ? "Filed" : "Draft"}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
