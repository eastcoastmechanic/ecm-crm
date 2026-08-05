import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { sendDocumentEmail } from "./actions";
import AssessmentDetail from "./AssessmentDetail";
import WarrantyDetail from "./WarrantyDetail";
import MassSaveRebateDetail from "./MassSaveRebateDetail";
import LineItemsEditor from "./LineItemsEditor";
import SubmitButton from "../../SubmitButton";
import { headingClass, subTextClass, buttonClass, buttonSecondaryClass } from "../../ui";

type LineItem = {
  category: string;
  description: string;
  price_book_item_name: string | null;
  qty: number;
  unit: string;
  good: number | null;
  better: number | null;
  best: number | null;
  notes: string | null;
};

const typeLabel: Record<string, string> = {
  estimate: "Estimate",
  invoice: "Invoice",
  proposal: "Proposal",
};

function formatPrice(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: doc, error } = await supabase
    .from("documents")
    .select("*, customers(name, email, phone), properties(address)")
    .eq("id", id)
    .single();

  if (error || !doc) notFound();

  if (doc.type === "assessment") {
    return <AssessmentDetail doc={doc} hasEmail={!!doc.customers?.email} />;
  }

  if (doc.type === "warranty") {
    return <WarrantyDetail doc={doc} hasEmail={!!doc.customers?.email} />;
  }

  if (doc.type === "mass_save_rebate") {
    return <MassSaveRebateDetail doc={doc} />;
  }

  const rawLineData = doc.line_items as {
    items?: LineItem[];
    brand?: { good: string | null; better: string | null; best: string | null };
    mass_save_eligible?: boolean;
    mass_save_note?: string | null;
    totals?: { good: number; better: number; best: number };
    option_label?: string | null;
    pricing_mode?: "tiered" | "flat";
  } | null;

  // Some older rows predate the totals/items shape (created before this
  // schema was finalized) — fall back rather than crash the page.
  const lineData = {
    items: rawLineData?.items ?? [],
    brand: rawLineData?.brand ?? { good: null, better: null, best: null },
    mass_save_eligible: rawLineData?.mass_save_eligible ?? false,
    mass_save_note: rawLineData?.mass_save_note ?? null,
    totals: rawLineData?.totals ?? { good: 0, better: 0, best: 0 },
    option_label: rawLineData?.option_label ?? null,
    pricing_mode: rawLineData?.pricing_mode ?? "tiered",
  };
  const isFlat = lineData.pricing_mode === "flat";

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className={headingClass}>
            {doc.doc_number} — {typeLabel[doc.type]}
          </h1>
          {lineData.option_label && (
            <span className="mt-1 inline-block rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">
              {lineData.option_label}
            </span>
          )}
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
          {doc.customers?.email ? (
            <form action={sendDocumentEmail}>
              <input type="hidden" name="id" value={doc.id} />
              <SubmitButton className={buttonClass} pendingText="Sending…">
                Send to Customer
              </SubmitButton>
            </form>
          ) : (
            <span className={subTextClass} title="Add an email to this customer to send documents">
              No customer email on file
            </span>
          )}
        </div>
      </div>
      {doc.status === "sent" && doc.sent_at && (
        <p className={subTextClass}>Sent {new Date(doc.sent_at).toLocaleString()}</p>
      )}

      {lineData.mass_save_eligible && (
        <div className="rounded-xl border border-green/30 bg-green-l/10 p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-green">
            MassSave Eligible
          </div>
          <p className="mt-1 text-sm text-white">{lineData.mass_save_note}</p>
        </div>
      )}

      {isFlat ? (
        <div className="rounded-xl border border-blue bg-blue/20 p-4 text-center sm:w-64">
          <div className="text-[10px] font-bold uppercase tracking-wide text-g300">Total</div>
          <div className="mt-1 font-display text-xl font-extrabold">
            {formatPrice(lineData.totals.better)}
          </div>
          <div className="mt-1 text-xs text-g300">{lineData.brand?.better || "—"}</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(["good", "better", "best"] as const).map((tier) => (
            <div
              key={tier}
              className={`rounded-xl border p-4 text-center ${
                tier === "better"
                  ? "border-blue bg-blue/20"
                  : tier === "best"
                    ? "border-accent/40 bg-accent/10"
                    : "border-white/8 bg-white/3"
              }`}
            >
              <div className="text-[10px] font-bold uppercase tracking-wide text-g300">
                {tier === "better" ? "Better ★" : tier}
              </div>
              <div className="mt-1 font-display text-xl font-extrabold">
                {formatPrice(lineData.totals[tier])}
              </div>
              <div className="mt-1 text-xs text-g300">{lineData.brand?.[tier] || "—"}</div>
            </div>
          ))}
        </div>
      )}

      <LineItemsEditor documentId={doc.id} status={doc.status} items={lineData.items} pricingMode={lineData.pricing_mode} />

      <details className="rounded-xl border border-white/8 bg-white/3 p-4">
        <summary className="cursor-pointer text-xs font-bold uppercase tracking-wide text-g300">
          Original request
        </summary>
        <p className="mt-2 text-sm text-white whitespace-pre-wrap">{doc.raw_request}</p>
      </details>
    </div>
  );
}
