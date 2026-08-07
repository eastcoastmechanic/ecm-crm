import Link from "next/link";
import { supabase } from "@/lib/supabase";
import InstallReportsList from "./InstallReportsList";
import { buttonClass, errorClass, headingClass, subTextClass } from "../../ui";

export default async function InstallReportsPage() {
  const { data: reports, error } = await supabase
    .from("install_reports")
    .select("*, customers(name), properties(address)")
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className={headingClass}>Install Reports</h1>
          <p className={subTextClass}>Lineset charge, pressure/vacuum tests, and sign-off for completed installs.</p>
        </div>
        <Link href="/tech-hub/install-report/new" className={buttonClass}>
          New Install Report
        </Link>
      </div>

      {error && <p className={errorClass}>Error loading install reports: {error.message}</p>}

      <InstallReportsList reports={reports ?? []} />
    </div>
  );
}
