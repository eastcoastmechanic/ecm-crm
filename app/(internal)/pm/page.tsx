import Link from "next/link";
import { listChecklists } from "@/lib/pm/db";
import { getMyStaffId } from "@/lib/job-access";
import { buttonClass, errorClass, headingClass, itemSubClass, itemTitleClass, subTextClass } from "../ui";
import { isTechRequest } from "./tech-access";

export const dynamic = "force-dynamic";

export default async function PmListPage() {
  // A tech sees only checklists for jobs that are theirs (or not yet assigned),
  // the same ones they can open. No staff row means nothing to show.
  const isTech = await isTechRequest();
  const techStaffId = isTech ? await getMyStaffId() : null;
  const { rows, error } =
    isTech && !techStaffId
      ? { rows: [], error: null }
      : await listChecklists(techStaffId ? { forTechStaffId: techStaffId } : {});
  // Techs open this page: show a plain line, log the real error (often SQL 0048 not run).
  if (error) console.error("[pm] listChecklists failed:", error);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className={headingClass}>Maintenance</h1>
          <p className={subTextClass}>Preventive maintenance checklists for a maintenance job and a piece of equipment.</p>
        </div>
        <div className="flex gap-2">
          {!isTech && (
            <Link href="/pm/templates" className="text-sm text-g300 underline">
              Edit templates
            </Link>
          )}
          <Link href="/pm/new" className={buttonClass}>
            New checklist
          </Link>
        </div>
      </div>
      {error && (
        <p className={errorClass}>This part isn&apos;t set up yet — tell the office.</p>
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
