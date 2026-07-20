import { notFound } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { headingClass, subTextClass, itemSubClass } from "../../ui";

type SuggestedLineItem = {
  price_book_item_name: string | null;
  description: string;
  qty: number;
  unit: string;
  notes: string | null;
};

type Readings = {
  outdoor_temp: number | null;
  indoor_temp: number | null;
  supply_air_temp: number | null;
  return_air_temp: number | null;
  indoor_rh: number | null;
  suction_pressure: number | null;
  liquid_pressure: number | null;
  suction_line_temp: number | null;
  liquid_line_temp: number | null;
  discharge_pressure: number | null;
  discharge_temp: number | null;
  amp_draw: number | null;
  voltage: number | null;
  refrigerant: string | null;
  superheat: number | null;
  subcooling: number | null;
  temp_split: number | null;
  symptoms: string;
};

function fmt(value: number | null, unit: string) {
  return value === null ? "—" : `${value}${unit}`;
}

export default async function DiagnosticPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: diagnostic, error } = await supabase
    .from("diagnostics")
    .select("*, equipment(type, brand, model, serial_number, properties(address, customers(name)))")
    .eq("id", id)
    .single();

  if (error || !diagnostic) notFound();

  const readings = diagnostic.readings as Readings;
  const lineItems = (diagnostic.suggested_line_items ?? []) as SuggestedLineItem[];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={headingClass}>
          {diagnostic.equipment?.type}
          {diagnostic.equipment?.brand ? ` — ${diagnostic.equipment.brand}` : ""}
          {diagnostic.equipment?.model ? ` ${diagnostic.equipment.model}` : ""}
        </h1>
        <p className={subTextClass}>
          {diagnostic.equipment?.properties?.customers?.name}
          {diagnostic.equipment?.properties?.address
            ? ` · ${diagnostic.equipment.properties.address}`
            : ""}
          {" · "}
          {new Date(diagnostic.created_at).toLocaleString()}
        </p>
      </div>

      <section className="rounded-xl border border-white/8 bg-white/3 p-4">
        <div className="text-xs font-bold uppercase tracking-wide text-g300">Symptoms</div>
        <p className="mt-1 text-sm text-white whitespace-pre-wrap">{readings.symptoms}</p>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-white/8 p-4 text-center">
          <div className="text-[10px] font-bold uppercase tracking-wide text-g300">Superheat</div>
          <div className="mt-1 font-display text-xl font-extrabold">{fmt(readings.superheat, "°F")}</div>
        </div>
        <div className="rounded-xl border border-white/8 p-4 text-center">
          <div className="text-[10px] font-bold uppercase tracking-wide text-g300">Subcooling</div>
          <div className="mt-1 font-display text-xl font-extrabold">{fmt(readings.subcooling, "°F")}</div>
        </div>
        <div className="rounded-xl border border-white/8 p-4 text-center">
          <div className="text-[10px] font-bold uppercase tracking-wide text-g300">Temp Split</div>
          <div className="mt-1 font-display text-xl font-extrabold">{fmt(readings.temp_split, "°F")}</div>
        </div>
      </div>

      <section className="rounded-xl border border-accent/30 bg-accent/5 p-4">
        <div className="text-xs font-bold uppercase tracking-wide text-accent">AI Diagnosis</div>
        <p className="mt-2 text-sm text-white whitespace-pre-wrap">{diagnostic.ai_diagnosis}</p>
      </section>

      <section className="rounded-xl border border-white/8 bg-white/3 p-4">
        <div className="text-xs font-bold uppercase tracking-wide text-g300">Suggested Fix</div>
        <p className="mt-2 text-sm text-white whitespace-pre-wrap">{diagnostic.suggested_fix}</p>
      </section>

      {lineItems.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-bold uppercase tracking-wide text-g300">
            Suggested Line Items
          </h2>
          <div className="overflow-x-auto rounded-xl border border-white/8">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/8 text-left text-[10px] font-bold uppercase tracking-wide text-g300">
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2">Qty</th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((item, i) => (
                  <tr key={i} className="border-b border-white/8 last:border-0">
                    <td className="px-3 py-2 align-top">
                      <div className="font-medium text-white">{item.description}</div>
                      {item.notes && <div className={itemSubClass}>{item.notes}</div>}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {item.qty} {item.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <details className="rounded-xl border border-white/8 bg-white/3 p-4">
        <summary className="cursor-pointer text-xs font-bold uppercase tracking-wide text-g300">
          Raw readings
        </summary>
        <div className="mt-3 grid gap-x-6 gap-y-1 text-sm text-white sm:grid-cols-2">
          <div>Refrigerant: {readings.refrigerant ?? "—"}</div>
          <div>Outdoor temp: {fmt(readings.outdoor_temp, "°F")}</div>
          <div>Indoor temp: {fmt(readings.indoor_temp, "°F")}</div>
          <div>Supply air temp: {fmt(readings.supply_air_temp, "°F")}</div>
          <div>Return air temp: {fmt(readings.return_air_temp, "°F")}</div>
          <div>Indoor RH: {fmt(readings.indoor_rh, "%")}</div>
          <div>Suction pressure: {fmt(readings.suction_pressure, " PSIG")}</div>
          <div>Liquid pressure: {fmt(readings.liquid_pressure, " PSIG")}</div>
          <div>Suction line temp: {fmt(readings.suction_line_temp, "°F")}</div>
          <div>Liquid line temp: {fmt(readings.liquid_line_temp, "°F")}</div>
          <div>Discharge pressure: {fmt(readings.discharge_pressure, " PSIG")}</div>
          <div>Discharge temp: {fmt(readings.discharge_temp, "°F")}</div>
          <div>Amp draw: {fmt(readings.amp_draw, "A")}</div>
          <div>Voltage: {fmt(readings.voltage, "V")}</div>
        </div>
      </details>

      <Link href="/diagnostics" className={subTextClass}>
        &larr; Back to diagnostics
      </Link>
    </div>
  );
}
