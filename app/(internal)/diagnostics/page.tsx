import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { buttonClass, errorClass, headingClass, itemSubClass, itemTitleClass, subTextClass } from "../ui";

export default async function DiagnosticsPage() {
  const { data: diagnostics, error } = await supabase
    .from("diagnostics")
    .select("*, equipment(type, brand, model, properties(address, customers(name)))")
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className={headingClass}>Diagnostics</h1>
          <p className={subTextClass}>
            AI fault diagnosis from field readings, logged per equipment.
          </p>
        </div>
        <Link href="/diagnostics/new" className={buttonClass}>
          New Diagnostic
        </Link>
      </div>

      {error && (
        <p className={errorClass}>Error loading diagnostics: {error.message}</p>
      )}

      <div className="flex flex-col divide-y divide-white/8">
        {diagnostics?.length === 0 && (
          <p className={subTextClass}>No diagnostics yet.</p>
        )}
        {diagnostics?.map((d) => (
          <Link
            key={d.id}
            href={`/diagnostics/${d.id}`}
            className="flex items-center justify-between gap-4 py-3 hover:bg-white/3"
          >
            <div>
              <div className={itemTitleClass}>
                {d.equipment?.type}
                {d.equipment?.brand ? ` — ${d.equipment.brand}` : ""}
                {d.equipment?.model ? ` ${d.equipment.model}` : ""}
              </div>
              <div className={itemSubClass}>
                {d.equipment?.properties?.customers?.name}
                {d.equipment?.properties?.address ? ` · ${d.equipment.properties.address}` : ""}
                {" · "}
                {new Date(d.created_at).toLocaleDateString()}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
