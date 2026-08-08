import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { supabase } from "@/lib/supabase";
import { sendDocumentEmail } from "./actions";
import AssessmentDetail from "./AssessmentDetail";
import WarrantyDetail from "./WarrantyDetail";
import MassSaveRebateDetail from "./MassSaveRebateDetail";
import LineItemsEditor from "./LineItemsEditor";
import EditCustomerForm from "../../customers/[id]/EditCustomerForm";
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
  cost?: number | null;
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

/**
 * Profit on the Better tier only (Better is the operative sell price
 * everywhere else in the CRM — totals, portal, PDFs). Items with no cost on
 * file are excluded from the cost sum but flagged via `incomplete`, so the
 * number reads as "profit on what we know" rather than silently pretending
 * unpriced items cost nothing.
 */
function computeProfit(items: LineItem[]) {
  let revenue = 0;
  let cost = 0;
  let incomplete = false;
  for (const item of items) {
    const sell = item.better ?? 0;
    revenue += sell * item.qty;
    if (item.cost === null || item.cost === undefined) {
      incomplete = incomplete || sell > 0;
      continue;
    }
    cost += item.cost * item.qty;
  }
  const profit = revenue - cost;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
  return { revenue, cost, profit, margin, incomplete };
}

// Owner-only — never rendered for other roles, and reads nothing that the
// customer-facing PDF (lib/pdf.tsx) or portal (/portal/documents) touch.
function ProfitCard({ items }: { items: LineItem[] }) {
  const { revenue, cost, profit, margin, incomplete } = computeProfit(items);
  return (
    <div className="rounded-xl border border-gold/30 bg-gold/5 p-4">
      <div className="text-[10px] font-bold uppercase tracking-wide text-gold">
        Profit — internal only, not visible to the customer
      </div>
      <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-g300">Revenue (Better)</div>
          <div className="font-display text-lg font-extrabold">{formatPrice(revenue)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-g300">Cost</div>
          <div className="font-display text-lg font-extrabold">{formatPrice(cost)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-g300">Profit</div>
          <div className="font-display text-lg font-extrabold text-gold">{formatPrice(profit)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-g300">Margin</div>
          <div className="font-display text-lg font-extrabold text-gold">{margin.toFixed(1)}%</div>
        </div>
      </div>
      {incomplete && (
        <p className="mt-2 text-xs text-g300">
          One or more line items have no cost on file — add it in the Cost column below (or on the
          price book item) for a complete number. Unpriced items count as $0 cost here, so this
          understates true cost until filled in.
        </p>
      )}
    </div>
  );
}

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const canSeeProfit = (await headers()).get("x-staff-role") === "owner";

  const { data: doc, error } = await supabase
    .from("documents")
    // Full customer record, not just the display fields: the header lets you
    // edit the customer inline (e.g. adding a missing email so the document
    // can actually be sent) without leaving the document.
    .select(
      "*, customers(id, name, email, phone, billing_address, notes, sms_consent), properties(address)"
    )
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
            {doc.customers?.id ? (
              <a href={`/customers/${doc.customers.id}`} className="underline hover:text-white">
                {doc.customers.name}
              </a>
            ) : (
              doc.customers?.name
            )}
            {doc.properties?.address ? ` · ${doc.properties.address}` : ""}
            {" · "}
            {new Date(doc.created_at).toLocaleDateString()}
          </p>
          {doc.customers?.id && <EditCustomerForm customer={doc.customers} />}
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
            <span className={subTextClass}>
              No customer email on file — use Edit to add one
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

      {canSeeProfit && <ProfitCard items={lineData.items} />}

      <LineItemsEditor
        documentId={doc.id}
        status={doc.status}
        items={lineData.items}
        pricingMode={lineData.pricing_mode}
        canSeeProfit={canSeeProfit}
      />

      <details className="rounded-xl border border-white/8 bg-white/3 p-4">
        <summary className="cursor-pointer text-xs font-bold uppercase tracking-wide text-g300">
          Original request
        </summary>
        <p className="mt-2 text-sm text-white whitespace-pre-wrap">{doc.raw_request}</p>
      </details>
    </div>
  );
}
