import { supabase } from "@/lib/supabase";
import DiagnosticForm from "./DiagnosticForm";
import { headingClass, subTextClass } from "../../ui";

export default async function NewDiagnosticPage({
  searchParams,
}: {
  searchParams: Promise<{ job_id?: string }>;
}) {
  const { job_id } = await searchParams;

  const { data: equipment } = await supabase
    .from("equipment")
    .select("id, type, brand, model, refrigerant_type, properties(address, customers(name))")
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={headingClass}>New Diagnostic</h1>
        <p className={subTextClass}>
          Enter field readings — Claude will calculate superheat/subcooling and diagnose the fault.
        </p>
      </div>

      <DiagnosticForm equipment={equipment ?? []} jobId={job_id} />
    </div>
  );
}
