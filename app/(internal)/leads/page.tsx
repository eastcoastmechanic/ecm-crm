import { supabase } from "@/lib/supabase";
import LeadsList from "./LeadsList";
import { headingClass, subTextClass, errorClass, buttonSecondaryClass } from "../ui";
import Link from "next/link";

export default async function LeadsPage() {
  const { data: leads, error } = await supabase
    .from("leads")
    .select("*, customers(name, phone, email)")
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className={headingClass}>Leads</h1>
          <p className={subTextClass}>
            Automatically sourced service/install leads — review, edit, and send or dismiss.
          </p>
        </div>
        <Link href="/leads/mls-import" className={buttonSecondaryClass}>
          Import MLS Export
        </Link>
      </div>

      {error && <p className={errorClass}>Error loading leads: {error.message}</p>}

      <LeadsList leads={leads ?? []} />
    </div>
  );
}
