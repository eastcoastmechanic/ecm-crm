import { notFound } from "next/navigation";
import Link from "next/link";
import { createPortalServerClient } from "@/lib/supabase-portal/server";
import { headingClass, itemSubClass, itemTitleClass, subTextClass } from "../../../(internal)/ui";

function formatDate(value: string | null) {
  if (!value) return "Unknown date";
  return new Date(value).toLocaleDateString();
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
  const supabase = await createPortalServerClient();

  const { data: equipment, error } = await supabase
    .from("equipment")
    .select("*, properties(address)")
    .eq("id", id)
    .single();

  if (error || !equipment) notFound();

  const propertyId = equipment.property_id as string | null;

  const [{ data: diagnostics }, { data: jobs }, { data: documents }] = await Promise.all([
    supabase
      .from("diagnostics")
      .select("id, created_at, ai_diagnosis, suggested_fix")
      .eq("equipment_id", id)
      .order("created_at", { ascending: false }),
    propertyId
      ? supabase
          .from("jobs")
          .select("id, scheduled_at, completed_at, status, notes")
          .eq("property_id", propertyId)
          .order("scheduled_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    propertyId
      ? supabase
          .from("documents")
          .select("id, doc_number, type, created_at, total")
          .eq("property_id", propertyId)
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
      title: `Service ${j.status}`,
      detail: j.notes,
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
        <p className={subTextClass}>{equipment.properties?.address}</p>
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
