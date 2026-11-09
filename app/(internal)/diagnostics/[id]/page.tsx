import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { signStoredPhotos } from "@/lib/photo-urls";
import { fetchAllPriceBookItems } from "@/lib/price-book";
import { checkJobAccess } from "@/lib/job-access";
import { formatEtShortDate, formatEtShortDateTime } from "@/lib/tz";
import { CreateReportInvoiceButton, SendReportButton } from "./ReportButtons";
import AssignCustomerForm from "./AssignCustomerForm";
import PartsUsedForm from "./PartsUsedForm";
import FinishReportForm from "./FinishReportForm";
import { headingClass, subTextClass, itemSubClass, buttonSecondaryClass } from "../../ui";

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
  // Techs work the report but never see money: no prices, invoice, PDF or customer email.
  const isTech = (await headers()).get("x-staff-role") === "tech";

  // A tech may open only a report for a job that is theirs (or not yet assigned),
  // the same rule the report's actions check. A report with no job is office and
  // owner only. Checked before the report itself is read.
  if (isTech) {
    const { data: owner } = await supabase.from("diagnostics").select("job_id").eq("id", id).maybeSingle();
    if (!owner) notFound();
    const access = await checkJobAccess(owner.job_id as string | null, { allowClosedJob: true });
    if (access.error !== undefined) notFound();
  }

  // The tech read leaves out the invoice (money) and customer email.
  // (The cast only keeps the row type; for a tech, invoice and email are simply absent.)
  const officeSelect =
    "*, equipment(type, brand, model, serial_number, properties(address, customers(name, email))), jobs(id, scheduled_at, status, customers(name, email), properties(address)), invoice:documents!invoice_document_id(doc_number, status, total)";
  const techSelect =
    "*, equipment(type, brand, model, serial_number, properties(address, customers(name))), jobs(id, scheduled_at, status, customers(name), properties(address))";
  const { data: diagnostic, error } = await supabase
    .from("diagnostics")
    .select((isTech ? techSelect : officeSelect) as typeof officeSelect)
    .eq("id", id)
    .single();

  if (error || !diagnostic) notFound();
  // Saved part prices never leave the server for a tech (the parts form also gets none).
  if (isTech) {
    diagnostic.actual_parts_used = ((diagnostic.actual_parts_used ?? []) as Record<string, unknown>[]).map((p) => ({
      ...p,
      unit_price: null,
    }));
  }

  const readings = diagnostic.readings as Readings;
  const lineItems = (diagnostic.suggested_line_items ?? []) as SuggestedLineItem[];
  // Bucket is private; sign server-side so the browser gets a fetchable URL.
  const photos = (await signStoredPhotos(
    (diagnostic.photos ?? []) as { url: string | null; caption: string | null }[]
  )) as { url: string | null; caption: string | null }[];
  const actualPartsUsed = (diagnostic.actual_parts_used ?? []) as {
    price_book_item_name: string;
    qty: number;
    unit_price: number | null;
  }[];

  const priceBookRows = await fetchAllPriceBookItems<{
    id: string;
    name: string;
    category: string | null;
    tier: string | null;
    unit_price: number | null;
  }>(supabase, isTech ? "id, name, category, tier" : "id, name, category, tier, unit_price");

  // One representative row per distinct part -- tiers are separate rows for
  // the same physical item, and "parts used" doesn't care which tier.
  const priceBookByName = new Map<string, { id: string; name: string; category: string | null; unit_price: number | null }>();
  for (const row of priceBookRows) {
    const existing = priceBookByName.get(row.name);
    if (!existing || row.tier === "better") {
      priceBookByName.set(row.name, { id: row.id, name: row.name, category: row.category, unit_price: row.unit_price ?? null });
    }
  }
  const priceBookOptions = Array.from(priceBookByName.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((o) => (isTech ? { ...o, unit_price: null } : o));

  const partsInitialRows = actualPartsUsed.length
    ? actualPartsUsed.map((p) => ({ name: p.price_book_item_name, qty: p.qty, unitPrice: isTech ? null : p.unit_price }))
    : lineItems
        .filter((li) => li.price_book_item_name && priceBookByName.has(li.price_book_item_name))
        .map((li) => ({
          name: li.price_book_item_name as string,
          qty: li.qty || 1,
          unitPrice: isTech ? null : (priceBookByName.get(li.price_book_item_name as string)?.unit_price ?? null),
        }));

  const displayCustomerName = diagnostic.equipment?.properties?.customers?.name ?? diagnostic.jobs?.customers?.name;
  const displayAddress = diagnostic.equipment?.properties?.address ?? diagnostic.jobs?.properties?.address;
  const displayEmail = diagnostic.equipment?.properties?.customers?.email ?? diagnostic.jobs?.customers?.email;
  const hasCustomer = !!displayCustomerName;
  const hasEmail = !!displayEmail;

  let assignFormData: {
    customers: { id: string; name: string }[];
    properties: { id: string; address: string; customer_id: string | null }[];
    equipment: { id: string; type: string; brand: string | null; model: string | null; property_id: string | null }[];
  } | null = null;

  if (!hasCustomer && !isTech) {
    const [{ data: customers }, { data: properties }, { data: equipmentRows }] = await Promise.all([
      supabase.from("customers").select("id, name").order("name"),
      supabase.from("properties").select("id, address, customer_id"),
      supabase.from("equipment").select("id, type, brand, model, property_id"),
    ]);
    assignFormData = {
      customers: customers ?? [],
      properties: properties ?? [],
      equipment: equipmentRows ?? [],
    };
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className={headingClass}>
            {diagnostic.doc_number ? `${diagnostic.doc_number} — ` : ""}
            {diagnostic.equipment?.type}
            {diagnostic.equipment?.brand ? ` — ${diagnostic.equipment.brand}` : ""}
            {diagnostic.equipment?.model ? ` ${diagnostic.equipment.model}` : ""}
          </h1>
          <p className={subTextClass}>
            {displayCustomerName ?? "No customer assigned yet"}
            {displayAddress ? ` · ${displayAddress}` : ""}
            {" · "}
            {formatEtShortDateTime(diagnostic.created_at)}
          </p>
          {diagnostic.jobs && (
            <p className={subTextClass}>
              From job:{" "}
              <Link href={isTech ? "/field-board" : "/jobs"} className="underline">
                {diagnostic.jobs.scheduled_at ? formatEtShortDate(diagnostic.jobs.scheduled_at) : "Not scheduled"}{" "}
                ({diagnostic.jobs.status})
              </Link>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isTech && (
            <>
          <a
            href={`/diagnostics/${id}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonSecondaryClass}
          >
            Download PDF
          </a>
          {diagnostic.report_sent_at ? (
            <span className={subTextClass}>
              Report sent {formatEtShortDate(diagnostic.report_sent_at)}
            </span>
          ) : (
            <SendReportButton id={id} disabled={!hasEmail} />
          )}
            </>
          )}
        </div>
      </div>

      {!hasCustomer && assignFormData && (
        <AssignCustomerForm
          diagnosticId={id}
          customers={assignFormData.customers}
          properties={assignFormData.properties}
          equipment={assignFormData.equipment}
        />
      )}

      {photos.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Photos</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {photos.map((photo, i) =>
              // null means the object is gone or wouldn't sign; skip it rather
              // than render a broken tile.
              photo.url ? (
                <a key={i} href={photo.url} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.url}
                    alt={photo.caption ?? "Service photo"}
                    className="aspect-video w-full rounded-lg border border-white/8 object-cover"
                  />
                </a>
              ) : null
            )}
          </div>
        </section>
      )}

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

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Parts Used</h2>
        <p className={itemSubClass}>
          Confirm the real parts used, resolved against the price book — pre-filled from the suggested line
          items above where a match was found. Saving deducts matching truck inventory on hand.
        </p>
        <PartsUsedForm diagnosticId={id} priceBookOptions={priceBookOptions} initialRows={partsInitialRows} showPrices={!isTech} />
      </section>

      <section className="flex flex-col gap-2 rounded-xl border border-white/8 bg-white/3 p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Time &amp; Finish</h2>
        {diagnostic.completed_at ? (
          <div className="flex flex-col gap-1">
            <p className={subTextClass}>
              Finished {formatEtShortDateTime(diagnostic.completed_at)}
              {diagnostic.tracked_hours !== null ? ` · ${diagnostic.tracked_hours} hrs tracked` : ""}
            </p>
            {isTech ? null : diagnostic.invoice ? (
              <Link href={`/documents/${diagnostic.invoice_document_id}`} className="text-sm underline">
                View {diagnostic.invoice.doc_number} — ${diagnostic.invoice.total} ({diagnostic.invoice.status})
              </Link>
            ) : (
              <div className="flex flex-col gap-2">
                <p className={itemSubClass}>No invoice was created for this report.</p>
                <CreateReportInvoiceButton id={id} />
              </div>
            )}
          </div>
        ) : (
          <FinishReportForm diagnosticId={id} canInvoice={!isTech} />
        )}
      </section>

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

      <Link href={isTech ? "/field-board" : "/diagnostics"} className={subTextClass}>
        &larr; {isTech ? "Back to field board" : "Back to diagnostics"}
      </Link>
    </div>
  );
}
