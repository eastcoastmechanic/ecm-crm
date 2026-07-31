import Link from "next/link";
import { supabase } from "@/lib/supabase";
import DiagnosticsList from "./DiagnosticsList";
import { buttonClass, errorClass, headingClass, subTextClass } from "../ui";

export default async function DiagnosticsPage() {
  const { data: diagnostics, error } = await supabase
    .from("diagnostics")
    .select(
      "*, equipment(type, brand, model, properties(address, customers(name))), jobs(customers(name), properties(address))"
    )
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

      <DiagnosticsList diagnostics={diagnostics ?? []} />
    </div>
  );
}
