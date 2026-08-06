import { supabase } from "@/lib/supabase";
import LeadsList from "./LeadsList";
import AutoRefresh from "./AutoRefresh";
import { headingClass, subTextClass, errorClass, buttonSecondaryClass } from "../ui";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const { data: leads, error } = await supabase
    .from("leads")
    .select("*, customers(name, phone, email)")
    .order("urgency_score", { ascending: false });

  return (
    <div className="flex flex-col gap-8">
      <AutoRefresh />
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className={headingClass}>Lead Radar</h1>
          <p className={subTextClass}>
            Automatically sourced service/install leads, plus anything added by hand — triaged by
            urgency and tracked through the sales pipeline. Updates live.
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
