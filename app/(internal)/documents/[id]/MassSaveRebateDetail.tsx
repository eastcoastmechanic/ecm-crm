import Link from "next/link";
import { headingClass, subTextClass, buttonSecondaryClass, itemSubClass } from "../../ui";

type StoredLineItems = {
  sponsor: { electric: string | null; gas: string | null };
  project: { housing_type: string | null; pre_existing_heating: string | null; rebate_types: string[] };
  equipment: { install_date: string | null; ahri_reference: string | null; tons: string | null }[];
};

const labelMap: Record<string, string> = {
  cape_light_compact: "Cape Light Compact",
  eversource: "Eversource",
  national_grid: "National Grid",
  unitil: "Unitil",
  berkshire_gas: "Berkshire Gas",
  liberty: "Liberty",
  other: "Other",
  single_family: "Single-Family",
  "2_4_unit": "2-4 unit building",
  "5_plus_unit": "5+ unit building",
  oil: "Oil",
  propane: "Propane",
  electric_resistance: "Electric Resistance",
  natural_gas: "Natural Gas",
  whole_home: "Whole-Home Rebate",
  partial_home: "Partial-Home Rebate",
  weatherization_bonus: "Weatherization Bonus",
  sizing_bonus: "Sizing Bonus",
};

export default function MassSaveRebateDetail({
  doc,
}: {
  doc: {
    id: string;
    doc_number: string | null;
    created_at: string;
    customers: { name: string | null } | null;
    properties: { address: string | null } | null;
    line_items: StoredLineItems;
  };
}) {
  const { sponsor, project, equipment } = doc.line_items;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className={headingClass}>
            {doc.doc_number ?? "Mass Save Rebate"} — Air Source Heat Pump Rebate
          </h1>
          <p className={subTextClass}>
            {doc.customers?.name}
            {doc.properties?.address ? ` · ${doc.properties.address}` : ""}
            {" · "}
            {new Date(doc.created_at).toLocaleDateString()}
          </p>
        </div>
        <a
          href={`/documents/${doc.id}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonSecondaryClass}
        >
          Download Filled Rebate Form
        </a>
      </div>

      <section className="rounded-xl border border-white/8 p-4">
        <div className="text-xs font-bold uppercase tracking-wide text-g300">Sponsor</div>
        <div className={`mt-1 ${itemSubClass}`}>
          Electric: {sponsor.electric ? (labelMap[sponsor.electric] ?? sponsor.electric) : "—"}
          {" · "}
          Gas: {sponsor.gas ? (labelMap[sponsor.gas] ?? sponsor.gas) : "—"}
        </div>
      </section>

      <section className="rounded-xl border border-white/8 p-4">
        <div className="text-xs font-bold uppercase tracking-wide text-g300">Project</div>
        <div className={`mt-1 ${itemSubClass}`}>
          Housing: {project.housing_type ? (labelMap[project.housing_type] ?? project.housing_type) : "—"}
          {" · "}
          Pre-existing heat:{" "}
          {project.pre_existing_heating
            ? (labelMap[project.pre_existing_heating] ?? project.pre_existing_heating)
            : "—"}
        </div>
        <div className={itemSubClass}>
          Rebate types:{" "}
          {project.rebate_types?.length
            ? project.rebate_types.map((t) => labelMap[t] ?? t).join(", ")
            : "—"}
        </div>
      </section>

      <section className="flex flex-col gap-2 rounded-xl border border-white/8 p-4">
        <div className="text-xs font-bold uppercase tracking-wide text-g300">Equipment</div>
        {equipment.map((eq, i) => (
          <div key={i} className={itemSubClass}>
            #{i + 1} — Installed {eq.install_date ?? "—"} · AHRI ref {eq.ahri_reference ?? "—"} ·{" "}
            {eq.tons ?? "—"} tons
          </div>
        ))}
      </section>

      <p className={subTextClass}>
        Download the filled form, review every field (some, like the installation address, are
        best-effort auto-fills), then print for the customer to sign and attach the invoice before
        submitting to Mass Save.
      </p>

      <Link href="/documents" className={subTextClass}>
        &larr; Back to documents
      </Link>
    </div>
  );
}
