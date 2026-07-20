import Link from "next/link";
import { redirect } from "next/navigation";
import { createPortalServerClient } from "@/lib/supabase-portal/server";
import { signOut } from "./actions";
import {
  buttonClass,
  buttonSecondaryClass,
  headingClass,
  itemSubClass,
  itemTitleClass,
  subTextClass,
} from "../(internal)/ui";

const typeLabel: Record<string, string> = {
  estimate: "Estimate",
  invoice: "Invoice",
  proposal: "Proposal",
};

const statusClass: Record<string, string> = {
  sent: "bg-blue/40 text-white",
  approved: "bg-green-l text-green",
  paid: "bg-green text-white",
};

function formatPrice(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function equipmentAge(installDate: string | null) {
  if (!installDate) return null;
  const years = (Date.now() - new Date(installDate).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
  return Math.floor(years);
}

function warrantyStatus(expiration: string | null) {
  if (!expiration) return { label: "Unknown", active: false };
  const expires = new Date(expiration);
  const active = expires.getTime() > Date.now();
  return {
    label: active ? `Active until ${expires.toLocaleDateString()}` : `Expired ${expires.toLocaleDateString()}`,
    active,
  };
}

export default async function PortalDashboard() {
  const supabase = await createPortalServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/portal/login");

  if (user.email) {
    // Covers the code-entry login path, which never hits /portal/auth/callback.
    // No-op if already claimed (RLS only allows this while unclaimed).
    await supabase
      .from("customers")
      .update({ auth_user_id: user.id })
      .eq("email", user.email)
      .is("auth_user_id", null);
  }

  const { data: customer } = await supabase.from("customers").select("*").limit(1).maybeSingle();

  if (!customer) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className={headingClass}>No account found</h1>
        <p className={subTextClass}>
          We couldn&apos;t find a customer record for {user.email}. Contact East Coast Mechanical
          to get your account linked.
        </p>
        <form action={signOut}>
          <button type="submit" className={`${buttonSecondaryClass} w-fit`}>
            Sign out
          </button>
        </form>
      </div>
    );
  }

  const { data: properties } = await supabase
    .from("properties")
    .select("*")
    .eq("customer_id", customer.id);

  const propertyIds = (properties ?? []).map((p) => p.id);

  const [{ data: equipment }, { data: contracts }, { data: documents }, { data: jobs }] =
    await Promise.all([
      propertyIds.length > 0
        ? supabase.from("equipment").select("*").in("property_id", propertyIds)
        : Promise.resolve({ data: [] }),
      supabase.from("service_contracts").select("*").eq("customer_id", customer.id),
      supabase
        .from("documents")
        .select("*")
        .eq("customer_id", customer.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("jobs")
        .select("*")
        .eq("customer_id", customer.id)
        .order("scheduled_at", { ascending: false }),
    ]);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className={headingClass}>Welcome, {customer.name}</h1>
          <p className={subTextClass}>Your equipment, service history, and invoices.</p>
        </div>
        <form action={signOut}>
          <button type="submit" className={`${buttonSecondaryClass} w-fit`}>
            Sign out
          </button>
        </form>
      </div>

      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Service Requests</h2>
        <Link href="/portal/request-service" className={buttonClass}>
          Request Service
        </Link>
      </div>
      <div className="flex flex-col divide-y divide-white/8 -mt-4">
        {jobs?.length === 0 && <p className={subTextClass}>No service requests yet.</p>}
        {jobs?.map((job) => (
          <div key={job.id} className="py-3">
            <div className={itemTitleClass}>
              {job.scheduled_at ? new Date(job.scheduled_at).toLocaleString() : "Date pending"}
            </div>
            <div className={itemSubClass}>
              {job.status}
              {job.notes ? ` · ${job.notes}` : ""}
            </div>
          </div>
        ))}
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Equipment</h2>
        <div className="flex flex-col divide-y divide-white/8">
          {equipment?.length === 0 && <p className={subTextClass}>No equipment on file.</p>}
          {equipment?.map((item) => {
            const age = equipmentAge(item.install_date);
            const warranty = warrantyStatus(item.warranty_expiration);
            return (
              <div key={item.id} className="py-3">
                <div className={itemTitleClass}>
                  {item.type}
                  {item.brand ? ` — ${item.brand}` : ""}
                  {item.model ? ` ${item.model}` : ""}
                </div>
                <div className={itemSubClass}>
                  {age !== null ? `${age} year${age === 1 ? "" : "s"} old` : "Install date unknown"}
                  {" · "}
                  Warranty: {warranty.label}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Service Contracts</h2>
        <div className="flex flex-col divide-y divide-white/8">
          {contracts?.length === 0 && <p className={subTextClass}>No active service contracts.</p>}
          {contracts?.map((contract) => (
            <div key={contract.id} className="py-3">
              <div className={itemTitleClass}>{contract.plan_name ?? "Service Plan"}</div>
              <div className={itemSubClass}>
                {contract.status}
                {contract.end_date ? ` · through ${new Date(contract.end_date).toLocaleDateString()}` : ""}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">
          Estimates &amp; Invoices
        </h2>
        <div className="flex flex-col divide-y divide-white/8">
          {documents?.length === 0 && <p className={subTextClass}>Nothing here yet.</p>}
          {documents?.map((doc) => (
            <Link
              key={doc.id}
              href={`/portal/documents/${doc.id}`}
              className="flex items-center justify-between gap-4 py-3 hover:bg-white/3"
            >
              <div>
                <div className={itemTitleClass}>
                  {doc.doc_number ?? typeLabel[doc.type]}
                  <span className={`ml-2 ${itemSubClass}`}>{typeLabel[doc.type]}</span>
                </div>
                <div className={itemSubClass}>{new Date(doc.created_at).toLocaleDateString()}</div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-3">
                <span className="font-mono text-sm text-white">{formatPrice(doc.total)}</span>
                <span
                  className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    statusClass[doc.status] ?? "bg-white/8 text-g300"
                  }`}
                >
                  {doc.status}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
