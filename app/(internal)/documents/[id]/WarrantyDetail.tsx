import Link from "next/link";
import { sendDocumentEmail } from "./actions";
import SubmitButton from "../../SubmitButton";
import WarrantyItemsEditor from "./WarrantyItemsEditor";
import { headingClass, subTextClass, buttonClass, buttonSecondaryClass, itemSubClass } from "../../ui";

export type WarrantyItem = {
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

const MANUFACTURER_COVERAGE_TEXT =
  "Covers replacement parts found to be defective in material or workmanship, per the manufacturer's published terms. Does not cover labor beyond what the manufacturer specifies, or damage from misuse, neglect, lack of routine maintenance, or unauthorized repairs. Registration with the manufacturer is required for full coverage — contact the manufacturer directly to file a parts claim using the docket number above.";

const CRAFTSMANSHIP_COVERAGE_TEXT =
  "East Coast Mechanical warrants that this installation was completed correctly and in accordance with manufacturer specifications and applicable code. If a defect in our workmanship causes a failure during the warranty period, we will repair or correct it at no charge for labor. Does not cover normal wear and tear, damage from misuse or lack of maintenance, acts of nature, or parts/work not installed by East Coast Mechanical.";

export default function WarrantyDetail({
  doc,
  hasEmail,
}: {
  doc: {
    id: string;
    doc_number: string | null;
    created_at: string;
    status: string;
    sent_at: string | null;
    customers: { name: string | null } | null;
    properties: { address: string | null } | null;
    line_items: { items: WarrantyItem[]; technician_name?: string | null };
  };
  hasEmail: boolean;
}) {
  const { items, technician_name } = doc.line_items;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className={headingClass}>{doc.doc_number} — Warranty Registration</h1>
          <p className={subTextClass}>
            {doc.customers?.name}
            {doc.properties?.address ? ` · ${doc.properties.address}` : ""}
            {" · "}
            {new Date(doc.created_at).toLocaleDateString()}
            {technician_name ? ` · Installed by ${technician_name}` : ""}
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <a
            href={`/documents/${doc.id}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonSecondaryClass}
          >
            Download PDF
          </a>
          {hasEmail ? (
            <form action={sendDocumentEmail} className="flex items-center gap-2">
              {doc.sent_at && (
                <span className={subTextClass}>
                  Last sent {new Date(doc.sent_at).toLocaleDateString()}
                </span>
              )}
              <input type="hidden" name="id" value={doc.id} />
              <SubmitButton className={buttonClass} pendingText="Sending…">
                Email to Customer
              </SubmitButton>
            </form>
          ) : (
            <span className={subTextClass} title="Add an email to this customer to send documents">
              No customer email on file
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {items.map((item, i) => (
          <section key={i} className="flex flex-col gap-3 rounded-xl border border-white/8 p-4">
            <div>
              <div className="font-medium text-white">{item.equipment_label}</div>
              <div className={itemSubClass}>
                {item.model ? `Model ${item.model}` : "Model —"}
                {" · "}
                {item.serial_number ? `S/N ${item.serial_number}` : "S/N —"}
                {" · "}
                Installed {formatDate(item.install_date)}
              </div>
            </div>

            <div className="rounded-lg border border-white/8 p-3">
              <div className="text-xs font-bold uppercase tracking-wide text-g300">
                Manufacturer Warranty
              </div>
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                <div className={itemSubClass}>Docket number: {item.manufacturer.docket_number ?? "—"}</div>
                <div className={itemSubClass}>
                  Length: {item.manufacturer.years !== null ? `${item.manufacturer.years} years` : "—"}
                </div>
                <div className={itemSubClass}>
                  Registered:{" "}
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      item.manufacturer.registered ? "bg-green/20 text-green" : "bg-white/8 text-g300"
                    }`}
                  >
                    {item.manufacturer.registered ? "Yes" : "No"}
                  </span>
                </div>
                <div className={itemSubClass}>
                  Date of registry: {formatDate(item.manufacturer.registration_date)}
                </div>
                <div className={itemSubClass}>Starts: {formatDate(item.install_date)}</div>
                <div className={itemSubClass}>Ends: {formatDate(item.manufacturer.expiration_date)}</div>
              </div>
              <p className={`mt-2 ${itemSubClass}`}>{MANUFACTURER_COVERAGE_TEXT}</p>
            </div>

            <div className="rounded-lg border border-accent/30 bg-accent/5 p-3">
              <div className="text-xs font-bold uppercase tracking-wide text-accent">
                Craftsmanship Warranty (East Coast Mechanical)
              </div>
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                <div className={itemSubClass}>
                  Length: {item.craftsmanship.years} year{item.craftsmanship.years === 1 ? "" : "s"} on
                  labor
                </div>
                <div className={itemSubClass}>Starts: {formatDate(item.install_date)}</div>
                <div className={itemSubClass}>Ends: {formatDate(item.craftsmanship.expiration_date)}</div>
              </div>
              <p className={`mt-2 ${itemSubClass}`}>{CRAFTSMANSHIP_COVERAGE_TEXT}</p>
            </div>
          </section>
        ))}
      </div>

      <div className="border-t border-white/8 pt-3">
        <div className={itemSubClass}>Issued by</div>
        <div className="font-medium text-white">Joshua Crowley</div>
        <div className={itemSubClass}>Owner, East Coast Mechanical</div>
      </div>

      <WarrantyItemsEditor documentId={doc.id} technicianName={technician_name ?? null} items={items} />

      <Link href="/documents" className={subTextClass}>
        &larr; Back to documents
      </Link>
    </div>
  );
}
