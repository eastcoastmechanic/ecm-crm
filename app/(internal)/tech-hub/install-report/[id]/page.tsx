import { notFound } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { headingClass, subTextClass, itemSubClass } from "../../../ui";

type CheckItem = { item: string; result: "yes" | "no" | "na" };

function fmt(value: number | null, unit: string) {
  return value === null || value === undefined ? "—" : `${value}${unit}`;
}

function dt(value: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

const resultLabel: Record<string, string> = { yes: "Yes", no: "No", na: "N/A" };
const resultClass: Record<string, string> = {
  yes: "text-green",
  no: "text-accent",
  na: "text-g500",
};

export default async function InstallReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: report, error } = await supabase
    .from("install_reports")
    .select("*, customers(name, email), properties(address), jobs(id, scheduled_at, status)")
    .eq("id", id)
    .single();

  if (error || !report) notFound();

  const checks = (report.startup_checks ?? []) as CheckItem[];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={headingClass}>
          {report.system_type ?? "Install Report"}
          {report.brand ? ` — ${report.brand}` : ""}
          {report.model ? ` ${report.model}` : ""}
        </h1>
        <p className={subTextClass}>
          {report.customers?.name ?? "No customer assigned"}
          {report.properties?.address ? ` · ${report.properties.address}` : ""}
          {" · "}
          {new Date(report.created_at).toLocaleString()}
        </p>
        {report.jobs && (
          <p className={subTextClass}>
            From job:{" "}
            <Link href="/jobs" className="underline">
              {new Date(report.jobs.scheduled_at).toLocaleDateString()} ({report.jobs.status})
            </Link>
          </p>
        )}
      </div>

      <section className="rounded-xl border border-white/8 bg-white/3 p-4">
        <div className="text-xs font-bold uppercase tracking-wide text-g300">System</div>
        <div className="mt-2 grid gap-x-6 gap-y-1 text-sm text-white sm:grid-cols-2">
          <div>Tech: {report.tech_name ?? "—"}</div>
          <div>Zone config: {report.zone_config ?? "—"}</div>
          <div>Serial: {report.serial ?? "—"}</div>
          <div>Refrigerant: {report.refrigerant_type ?? "—"}</div>
        </div>
      </section>

      <section className="rounded-xl border border-white/8 p-4">
        <div className="text-xs font-bold uppercase tracking-wide text-g300">Lineset Charge</div>
        <div className="mt-2 grid gap-x-6 gap-y-1 text-sm text-white sm:grid-cols-2">
          <div>Lineset size: {report.lineset_size ?? "—"}</div>
          <div>Lineset length: {fmt(report.lineset_total_ft, " ft")}</div>
          <div>Factory charge: {fmt(report.factory_charge_oz, " oz")}</div>
          <div>Charge rate: {fmt(report.charge_rate_oz_per_ft, " oz/ft")}</div>
          <div>Actual charge added: {fmt(report.actual_charge_added_oz, " oz")}</div>
        </div>
      </section>

      <section className="rounded-xl border border-white/8 p-4">
        <div className="text-xs font-bold uppercase tracking-wide text-g300">Nitrogen Pressure Test</div>
        <div className="mt-2 grid gap-x-6 gap-y-1 text-sm text-white sm:grid-cols-2">
          <div>Test pressure: {fmt(report.pressure_test_psig, " PSIG")}</div>
          <div>Ambient temp: {fmt(report.pressure_test_ambient_f, "°F")}</div>
          <div>Start: {dt(report.pressure_test_start_at)}</div>
          <div>End: {dt(report.pressure_test_end_at)}</div>
          <div>Start pressure: {fmt(report.pressure_test_start_psig, " PSIG")}</div>
          <div>End pressure: {fmt(report.pressure_test_end_psig, " PSIG")}</div>
        </div>
      </section>

      <section className="rounded-xl border border-white/8 p-4">
        <div className="text-xs font-bold uppercase tracking-wide text-g300">Vacuum &amp; Decay</div>
        <div className="mt-2 grid gap-x-6 gap-y-1 text-sm text-white sm:grid-cols-2">
          <div>Target vacuum: {fmt(report.vacuum_target_microns, " microns")}</div>
          <div>Vacuum achieved: {fmt(report.vacuum_achieved_microns, " microns")}</div>
          <div>Decay start: {fmt(report.decay_start_microns, " microns")}</div>
          <div>Decay end: {fmt(report.decay_end_microns, " microns")}</div>
          <div>Decay duration: {fmt(report.decay_duration_min, " min")}</div>
        </div>
      </section>

      {checks.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Startup Checklist</h2>
          <div className="flex flex-col divide-y divide-white/8 rounded-xl border border-white/8">
            {checks.map((c, i) => (
              <div key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="text-sm text-white">{c.item}</span>
                <span className={`text-xs font-semibold ${resultClass[c.result] ?? "text-g500"}`}>
                  {resultLabel[c.result] ?? c.result}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {report.notes && (
        <section className="rounded-xl border border-white/8 bg-white/3 p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-g300">Notes</div>
          <p className="mt-1 text-sm text-white whitespace-pre-wrap">{report.notes}</p>
        </section>
      )}

      <section className="rounded-xl border border-white/8 p-4">
        <div className="text-xs font-bold uppercase tracking-wide text-g300">Sign-off</div>
        <div className="mt-2 grid gap-x-6 gap-y-1 text-sm text-white sm:grid-cols-2">
          <div>Tech: {report.tech_sign_name ?? "—"}</div>
          <div>Customer: {report.customer_sign_name ?? "Not yet signed"}</div>
        </div>
        {report.signed_at && <div className={itemSubClass}>Signed {new Date(report.signed_at).toLocaleString()}</div>}
      </section>

      <Link href="/tech-hub/install-report" className={subTextClass}>
        &larr; Back to install reports
      </Link>
    </div>
  );
}
