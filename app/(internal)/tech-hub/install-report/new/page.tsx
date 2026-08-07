import { supabase } from "@/lib/supabase";
import InstallReportForm from "./InstallReportForm";
import { headingClass, subTextClass } from "../../../ui";

export default async function NewInstallReportPage({
  searchParams,
}: {
  searchParams: Promise<{ job_id?: string }>;
}) {
  const { job_id } = await searchParams;

  const { data: equipment } = await supabase
    .from("equipment")
    .select("id, type, brand, model, serial_number, refrigerant_type, properties(address, customers(name))")
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={headingClass}>New Install Report</h1>
        <p className={subTextClass}>
          Lineset charge, nitrogen pressure test, vacuum/decay, startup checklist, and sign-off for a
          completed installation.
        </p>
      </div>

      <InstallReportForm equipment={equipment ?? []} jobId={job_id} />
    </div>
  );
}
