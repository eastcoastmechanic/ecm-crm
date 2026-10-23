import { headers } from "next/headers";
import { supabase } from "@/lib/supabase";
import DiagnosticForm from "./DiagnosticForm";
import { headingClass, subTextClass } from "../../ui";

export default async function NewDiagnosticPage({
  searchParams,
}: {
  searchParams: Promise<{ job_id?: string }>;
}) {
  const { job_id } = await searchParams;

  // A tech opening this from a job sees that property's equipment, not every unit on file.
  const isTech = (await headers()).get("x-staff-role") === "tech";
  let propertyId: string | null = null;
  if (isTech && job_id) {
    const { data: job } = await supabase.from("jobs").select("property_id").eq("id", job_id).maybeSingle();
    propertyId = (job?.property_id as string | null) ?? null;
  }

  let equipmentQuery = supabase
    .from("equipment")
    .select("id, type, brand, model, refrigerant_type, properties(address, customers(name))")
    .order("created_at", { ascending: false });
  if (propertyId) equipmentQuery = equipmentQuery.eq("property_id", propertyId);
  // A tech with no job (or one with no property) gets no equipment list: it would
  // expose every customer's name and address.
  const { data: equipmentRows } = isTech && !propertyId ? { data: [] } : await equipmentQuery;
  const equipment = equipmentRows ?? [];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={headingClass}>New Diagnostic</h1>
        <p className={subTextClass}>
          Enter field readings — Claude will calculate superheat/subcooling and diagnose the fault.
        </p>
      </div>

      <DiagnosticForm equipment={equipment} jobId={job_id} />
    </div>
  );
}
