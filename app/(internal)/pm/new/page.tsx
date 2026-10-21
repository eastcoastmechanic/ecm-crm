import { supabase } from "@/lib/supabase";
import { headingClass, subTextClass } from "../../ui";
import NewPmForm from "./NewPmForm";

export const dynamic = "force-dynamic";

type JobRow = {
  id: string;
  job_type: string | null;
  scheduled_at: string | null;
  status: string | null;
  property_id: string | null;
  customers: { name: string | null } | { name: string | null }[] | null;
  properties: { address: string | null; property_type: string | null } | { address: string | null; property_type: string | null }[] | null;
};

function first<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export default async function NewPmPage({ searchParams }: { searchParams: Promise<{ job_id?: string }> }) {
  const { job_id: jobId } = await searchParams;
  const [{ data: jobs }, { data: equipment }, { data: templates }] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, job_type, scheduled_at, status, property_id, customers(name), properties(address, property_type)")
      .neq("status", "cancelled")
      .order("scheduled_at", { ascending: false })
      .limit(80),
    supabase.from("equipment").select("id, property_id, type, brand, model, serial_number").order("type").limit(300),
    supabase.from("pm_templates").select("id, slug, name, audience").order("audience"),
  ]);

  const jobOptions = ((jobs ?? []) as JobRow[])
    .map((job) => {
      const customer = first(job.customers);
      const property = first(job.properties);
      const when = job.scheduled_at ? new Date(job.scheduled_at).toLocaleDateString() : "Unscheduled";
      return {
        id: job.id,
        job_type: job.job_type,
        scheduled_at: job.scheduled_at,
        property_id: job.property_id,
        property_type: property?.property_type ?? null,
        label: `${job.job_type ?? "job"} · ${customer?.name ?? "Customer"} · ${property?.address ?? "No address"} · ${when}`,
      };
    })
    .sort((a, b) => Number(b.job_type === "maintenance") - Number(a.job_type === "maintenance"));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className={headingClass}>New PM checklist</h1>
        <p className={subTextClass}>
          Attach it to the maintenance visit and the equipment you are working on. Maintenance jobs are listed first.
          Residential or commercial is suggested from the property, and you can change it.
        </p>
      </div>
      <NewPmForm
        jobs={jobOptions}
        equipment={(equipment ?? []).map((item) => ({
          id: item.id,
          property_id: item.property_id,
          label: [item.type, item.brand, item.model, item.serial_number].filter(Boolean).join(" · "),
        }))}
        templates={templates ?? []}
        initialJobId={jobId ?? null}
      />
    </div>
  );
}
