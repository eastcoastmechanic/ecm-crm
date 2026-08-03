import Link from "next/link";
import { headingClass, subTextClass, itemSubClass } from "../../ui";

type WarrantyLineData = {
  equipment_label: string;
  model: string | null;
  serial_number: string | null;
  install_date: string | null;
  manufacturer: {
    docket_number: string | null;
    years: number | null;
    registered: boolean;
    registration_date: string | null;
    expiration_date: string | null;
  };
  craftsmanship: {
    years: number;
    expiration_date: string | null;
  };
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00`).toLocaleDateString();
}

export default function WarrantyDetail({
  doc,
}: {
  doc: {
    id: string;
    doc_number: string | null;
    created_at: string;
    customers: { name: string | null } | null;
    properties: { address: string | null } | null;
    line_items: WarrantyLineData;
  };
}) {
  const { equipment_label, model, serial_number, install_date, manufacturer, craftsmanship } =
    doc.line_items;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={headingClass}>{doc.doc_number} — Warranty Registration</h1>
        <p className={subTextClass}>
          {doc.customers?.name}
          {doc.properties?.address ? ` · ${doc.properties.address}` : ""}
          {" · "}
          {new Date(doc.created_at).toLocaleDateString()}
        </p>
      </div>

      <section className="rounded-xl border border-white/8 p-4">
        <div className="text-xs font-bold uppercase tracking-wide text-g300">Equipment</div>
        <div className="mt-1 font-medium text-white">{equipment_label}</div>
        <div className={itemSubClass}>
          {model ? `Model ${model}` : "Model —"}
          {" · "}
          {serial_number ? `S/N ${serial_number}` : "S/N —"}
          {" · "}
          Installed {formatDate(install_date)}
        </div>
      </section>

      <section className="rounded-xl border border-white/8 p-4">
        <div className="text-xs font-bold uppercase tracking-wide text-g300">Manufacturer Warranty</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <div className={itemSubClass}>Docket number: {manufacturer.docket_number ?? "—"}</div>
          <div className={itemSubClass}>
            Length: {manufacturer.years !== null ? `${manufacturer.years} years` : "—"}
          </div>
          <div className={itemSubClass}>
            Registered:{" "}
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                manufacturer.registered ? "bg-green/20 text-green" : "bg-white/8 text-g300"
              }`}
            >
              {manufacturer.registered ? "Yes" : "No"}
            </span>
          </div>
          <div className={itemSubClass}>Date of registry: {formatDate(manufacturer.registration_date)}</div>
          <div className={itemSubClass}>Expires: {formatDate(manufacturer.expiration_date)}</div>
        </div>
      </section>

      <section className="rounded-xl border border-accent/30 bg-accent/5 p-4">
        <div className="text-xs font-bold uppercase tracking-wide text-accent">
          Craftsmanship Warranty (East Coast Mechanical)
        </div>
        <div className={`mt-2 ${itemSubClass}`}>
          {craftsmanship.years} year{craftsmanship.years === 1 ? "" : "s"} on labor — expires{" "}
          {formatDate(craftsmanship.expiration_date)}
        </div>
      </section>

      <Link href="/documents" className={subTextClass}>
        &larr; Back to documents
      </Link>
    </div>
  );
}
