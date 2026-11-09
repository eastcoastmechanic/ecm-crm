import { notFound } from "next/navigation";
import Link from "next/link";
import { supabase as adminDb } from "@/lib/supabase";
import { one } from "@/lib/appointment-reminder";
import { portalCustomerFor, requirePortalUser } from "@/lib/portal-customer";
import { formatPortalDate, portalJobNote, portalStatusLabel } from "@/lib/portal-view";
import { headingClass, itemSubClass, itemTitleClass, subTextClass } from "../../../(internal)/ui";

function formatDate(value: string | null) {
  return formatPortalDate(value) ?? "Unknown date";
}

type TimelineEntry = {
  date: string;
  title: string;
  detail: string | null;
};

export default async function PortalEquipmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requirePortalUser();
  const customer = await portalCustomerFor(user.id);
  if (!customer) notFound();

  // Read on the server with the service client. The equipment must sit on one
  // of this customer's properties; only the columns this page shows are read.
  const { data: equipment, error } = await adminDb
    .from("equipment")
    .select(
      "id, type, brand, model, install_date, warranty_expiration, serial_number, property_id, properties!inner(address, customer_id)"
    )
    .eq("id", id)
    .eq("properties.customer_id", customer.id)
    .maybeSingle();

  if (error || !equipment) notFound();

  const propertyId = equipment.property_id as string | null;
  const property = one(equipment.properties as { address: string | null } | { address: string | null }[] | null);

  const [{ data: diagnostics }, { data: jobs }, { data: documents }] = await Promise.all([
    adminDb
      .from("diagnostics")
      .select("id, created_at, ai_diagnosis, suggested_fix")
      .eq("equipment_id", id)
      .order("created_at", { ascending: false }),
    propertyId
      ? adminDb
          .from("jobs")
          .select("id, scheduled_at, completed_at, status, notes")
          .eq("property_id", propertyId)
          .eq("customer_id", customer.id)
          .order("scheduled_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    // Drafts haven't been reviewed or sent yet: never shown in the portal.
    propertyId
      ? adminDb
          .from("documents")
          .select("id, doc_number, type, created_at, total")
          .eq("property_id", propertyId)
          .eq("customer_id", customer.id)
          .neq("status", "draft")
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  const timeline: TimelineEntry[] = [
    ...(diagnostics ?? []).map((d) => ({
      date: d.created_at,
      title: "Diagnostic visit",
      detail: d.ai_diagnosis ?? d.suggested_fix ?? null,
    })),
    ...(jobs ?? []).map((j) => ({
      date: j.completed_at ?? j.scheduled_at,
      title: `Service ${portalStatusLabel(j.status).toLowerCase()}`,
      detail: portalJobNote(j.status, j.notes),
    })),
    ...(documents ?? []).map((doc) => ({
      date: doc.created_at,
      title: `${doc.type === "invoice" ? "Invoice" : doc.type === "proposal" ? "Proposal" : "Estimate"} ${doc.doc_number ?? ""}`,
      detail: doc.total ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(doc.total) : null,
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className={headingClass}>
          {equipment.type}
          {equipment.brand ? ` — ${equipment.brand}` : ""}
          {equipment.model ? ` ${equipment.model}` : ""}
        </h1>
        <p className={subTextClass}>{property?.address}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-white/8 bg-white/3 p-4">
          <div className="text-[10px] font-bold uppercase tracking-wide text-g300">Installed</div>
          <div className="mt-1 text-sm text-white">{formatDate(equipment.install_date)}</div>
        </div>
        <div className="rounded-xl border border-white/8 bg-white/3 p-4">
          <div className="text-[10px] font-bold uppercase tracking-wide text-g300">Warranty</div>
          <div className="mt-1 text-sm text-white">{formatDate(equipment.warranty_expiration)}</div>
        </div>
        <div className="rounded-xl border border-white/8 bg-white/3 p-4">
          <div className="text-[10px] font-bold uppercase tracking-wide text-g300">
            Serial number
          </div>
          <div className="mt-1 text-sm text-white">{equipment.serial_number ?? "—"}</div>
        </div>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Service history</h2>
        <div className="flex flex-col divide-y divide-white/8">
          {timeline.length === 0 && <p className={subTextClass}>No history on file yet.</p>}
          {timeline.map((entry, i) => (
            <div key={i} className="py-3">
              <div className={itemTitleClass}>{entry.title}</div>
              <div className={itemSubClass}>
                {formatDate(entry.date)}
                {entry.detail ? ` · ${entry.detail}` : ""}
              </div>
            </div>
          ))}
        </div>
      </section>

      <Link href="/portal" className={subTextClass}>
        &larr; Back to dashboard
      </Link>
    </div>
  );
}
