import { notFound } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { headingClass, subTextClass, itemSubClass, itemTitleClass, errorClass } from "../../ui";
import EditCustomerForm from "./EditCustomerForm";

export default async function CustomerProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: customer, error } = await supabase
    .from("customers")
    .select("*, referred_by:referred_by_customer_id(id, name)")
    .eq("id", id)
    .single();

  if (error || !customer) notFound();

  const referredBy = customer.referred_by as unknown as { id: string; name: string } | null;

  const { data: referrals } = await supabase
    .from("customers")
    .select("id, name, referral_reward_sent_at")
    .eq("referred_by_customer_id", id);

  const { data: properties } = await supabase
    .from("properties")
    .select("id, address, property_type")
    .eq("customer_id", id);

  const propertyIds = (properties ?? []).map((p) => p.id);

  type CustomerDiagnostic = {
    id: string;
    doc_number: string | null;
    ai_diagnosis: string | null;
    created_at: string;
    equipment: { type: string | null; brand: string | null; model: string | null; property_id: string } | null;
  };

  const [{ data: equipment }, { data: jobs }, { data: documents }, { data: diagnostics }] =
    await Promise.all([
      propertyIds.length
        ? supabase
            .from("equipment")
            .select("id, type, brand, model, serial_number, property_id")
            .in("property_id", propertyIds)
        : Promise.resolve({ data: [] }),
      supabase
        .from("jobs")
        .select("id, scheduled_at, status, notes")
        .eq("customer_id", id)
        .order("scheduled_at", { ascending: false }),
      supabase
        .from("documents")
        .select("id, doc_number, type, status, total")
        .eq("customer_id", id)
        .order("created_at", { ascending: false }),
      propertyIds.length
        ? supabase
            .from("diagnostics")
            .select("id, doc_number, ai_diagnosis, created_at, equipment(type, brand, model, property_id)")
            .order("created_at", { ascending: false })
            .returns<CustomerDiagnostic[]>()
        : Promise.resolve({ data: [] as CustomerDiagnostic[] }),
    ]);

  const equipmentByProperty = new Map<string, typeof equipment>();
  for (const item of equipment ?? []) {
    const list = equipmentByProperty.get(item.property_id) ?? [];
    list.push(item);
    equipmentByProperty.set(item.property_id, list);
  }

  const customerDiagnostics = (diagnostics ?? []).filter((d) =>
    d.equipment?.property_id ? propertyIds.includes(d.equipment.property_id) : false
  );

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/customers" className={subTextClass}>
          &larr; Back to customers
        </Link>
        <h1 className={`${headingClass} mt-2`}>{customer.name}</h1>
        <p className={subTextClass}>
          {[customer.email, customer.phone].filter(Boolean).join(" · ")}
        </p>
        {customer.notes && <p className={`${subTextClass} mt-1`}>{customer.notes}</p>}
        {referredBy && (
          <p className={`${subTextClass} mt-1`}>
            Referred by{" "}
            <Link href={`/customers/${referredBy.id}`} className="underline">
              {referredBy.name}
            </Link>
          </p>
        )}
        <EditCustomerForm customer={customer} />
      </div>

      {error && <p className={errorClass}>Error loading customer: {error}</p>}

      {(referrals ?? []).length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Referrals Made</h2>
          <div className="flex flex-col divide-y divide-white/8">
            {(referrals ?? []).map((r) => (
              <Link
                key={r.id}
                href={`/customers/${r.id}`}
                className="flex items-center justify-between py-2 hover:bg-white/3"
              >
                <div className={itemTitleClass}>{r.name}</div>
                <div className={itemSubClass}>
                  {r.referral_reward_sent_at ? "Reward sent" : "Pending first paid invoice"}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">
          Properties &amp; Equipment
        </h2>
        {(properties ?? []).length === 0 && <p className={subTextClass}>No properties on file.</p>}
        <div className="flex flex-col gap-3">
          {(properties ?? []).map((property) => (
            <div key={property.id} className="rounded-xl border border-white/8 p-4">
              <div className={itemTitleClass}>{property.address}</div>
              {property.property_type && <div className={itemSubClass}>{property.property_type}</div>}
              <div className="mt-2 flex flex-col gap-1">
                {(equipmentByProperty.get(property.id) ?? []).map((item) => (
                  <div key={item.id} className={itemSubClass}>
                    {item.type}
                    {item.brand ? ` — ${item.brand}` : ""}
                    {item.model ? ` ${item.model}` : ""}
                    {item.serial_number ? ` (S/N ${item.serial_number})` : ""}
                  </div>
                ))}
                {(equipmentByProperty.get(property.id) ?? []).length === 0 && (
                  <div className={itemSubClass}>No equipment on file.</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Jobs</h2>
        {(jobs ?? []).length === 0 && <p className={subTextClass}>No jobs yet.</p>}
        <div className="flex flex-col divide-y divide-white/8">
          {(jobs ?? []).map((job) => (
            <div key={job.id} className="py-2">
              <div className={itemTitleClass}>
                {job.scheduled_at ? new Date(job.scheduled_at).toLocaleString() : "No date"}
                <span className={`ml-2 ${itemSubClass}`}>({job.status})</span>
              </div>
              {job.notes && <div className={itemSubClass}>{job.notes}</div>}
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Documents</h2>
        {(documents ?? []).length === 0 && <p className={subTextClass}>No documents yet.</p>}
        <div className="flex flex-col divide-y divide-white/8">
          {(documents ?? []).map((doc) => (
            <Link
              key={doc.id}
              href={`/documents/${doc.id}`}
              className="flex items-center justify-between py-2 hover:bg-white/3"
            >
              <div className={itemTitleClass}>
                {doc.doc_number ?? doc.type}
                <span className={`ml-2 ${itemSubClass}`}>({doc.status})</span>
              </div>
              <div className={itemSubClass}>
                {doc.total ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(doc.total) : ""}
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Service Reports</h2>
        {customerDiagnostics.length === 0 && <p className={subTextClass}>No service reports yet.</p>}
        <div className="flex flex-col divide-y divide-white/8">
          {customerDiagnostics.map((d) => (
            <Link
              key={d.id}
              href={`/diagnostics/${d.id}`}
              className="flex items-center justify-between py-2 hover:bg-white/3"
            >
              <div className={itemTitleClass}>
                {d.doc_number ?? "Report"}
                <span className={`ml-2 ${itemSubClass}`}>
                  {d.equipment?.type}
                  {d.equipment?.brand ? ` — ${d.equipment.brand}` : ""}
                </span>
              </div>
              <div className={itemSubClass}>{new Date(d.created_at).toLocaleDateString()}</div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
