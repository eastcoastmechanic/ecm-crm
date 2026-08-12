import Link from "next/link";
import { sendDocumentEmail } from "./actions";
import SubmitButton from "../../SubmitButton";
import { headingClass, subTextClass, buttonClass, buttonSecondaryClass, itemSubClass } from "../../ui";

type AssessmentItem = {
  equipment_id: string | null;
  equipment_label: string;
  equipment_serial: string | null;
  age_years: number | null;
  condition: string;
  observations: string;
  photos: { url: string; caption: string | null }[];
  condition_summary: string;
  recommendation: "no_action" | "monitor" | "repair" | "replace";
  estimated_remaining_life_years: number | null;
};

const conditionLabel: Record<string, string> = {
  working_well: "Working Well",
  working_with_issues: "Working, With Issues",
  not_working: "Not Working",
};

const recommendationLabel: Record<string, string> = {
  no_action: "No Action Needed",
  monitor: "Monitor",
  repair: "Repair Recommended",
  replace: "Replacement Recommended",
};

const recommendationClass: Record<string, string> = {
  no_action: "bg-green/20 text-green",
  monitor: "bg-gold/20 text-gold",
  repair: "bg-gold/20 text-gold",
  replace: "bg-accent/20 text-accent",
};

export default function AssessmentDetail({
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
    line_items: { items: AssessmentItem[]; overall_summary: string };
  };
  hasEmail: boolean;
}) {
  const { items, overall_summary } = doc.line_items;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className={headingClass}>{doc.doc_number} — Condition Assessment</h1>
          <p className={subTextClass}>
            {doc.customers?.name}
            {doc.properties?.address ? ` · ${doc.properties.address}` : ""}
            {" · "}
            {new Date(doc.created_at).toLocaleDateString()}
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

      <section className="rounded-xl border border-accent/30 bg-accent/5 p-4">
        <div className="text-xs font-bold uppercase tracking-wide text-accent">System Overview</div>
        <p className="mt-2 text-sm text-white whitespace-pre-wrap">{overall_summary}</p>
      </section>

      <div className="flex flex-col gap-4">
        {items.map((item, i) => (
          <section key={i} className="flex flex-col gap-2 rounded-xl border border-white/8 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-medium text-white">{item.equipment_label}</div>
                <div className={itemSubClass}>
                  {item.equipment_serial ? `S/N ${item.equipment_serial} · ` : ""}
                  {item.age_years !== null ? `${item.age_years} years old` : "Age unknown"}
                  {" · "}
                  {conditionLabel[item.condition] ?? item.condition}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    recommendationClass[item.recommendation] ?? "bg-white/8 text-g300"
                  }`}
                >
                  {recommendationLabel[item.recommendation] ?? item.recommendation}
                </span>
                {item.estimated_remaining_life_years !== null && (
                  <span className="rounded bg-white/8 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-g300">
                    ~{item.estimated_remaining_life_years} yrs remaining
                  </span>
                )}
              </div>
            </div>

            <p className="text-sm text-white whitespace-pre-wrap">{item.condition_summary}</p>

            {item.observations && (
              <p className={itemSubClass}>Tech notes: {item.observations}</p>
            )}

            {item.photos.some((p) => p.url) && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {item.photos.map((photo, pi) =>
                  photo.url ? (
                    <a key={pi} href={photo.url} target="_blank" rel="noopener noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo.url}
                        alt={photo.caption ?? "Equipment photo"}
                        className="aspect-video w-full rounded-lg border border-white/8 object-cover"
                      />
                    </a>
                  ) : null
                )}
              </div>
            )}
          </section>
        ))}
      </div>

      <Link href="/documents" className={subTextClass}>
        &larr; Back to documents
      </Link>
    </div>
  );
}
