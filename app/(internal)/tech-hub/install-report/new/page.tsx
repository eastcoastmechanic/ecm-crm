import { headers } from "next/headers";
import { supabase } from "@/lib/supabase";
import InstallReportForm from "./InstallReportForm";
import { headingClass, subTextClass } from "../../../ui";

export default async function NewInstallReportPage({
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
    .select("id, type, brand, model, serial_number, refrigerant_type, properties(address, customers(name))")
    .order("created_at", { ascending: false });
  if (propertyId) equipmentQuery = equipmentQuery.eq("property_id", propertyId);
  // A tech with no job (or one with no property) gets no equipment list: it would
  // expose every customer's name and address.
  const { data: equipmentRows } = isTech && !propertyId ? { data: [] } : await equipmentQuery;
  const equipment = equipmentRows ?? [];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={headingClass}>New Install Report</h1>
        <p className={subTextClass}>
          Lineset charge, nitrogen pressure test, vacuum/decay, startup checklist, and sign-off for a
          completed installation.
        </p>
      </div>

      <InstallReportForm equipment={equipment} jobId={job_id} />
    </div>
  );
}
