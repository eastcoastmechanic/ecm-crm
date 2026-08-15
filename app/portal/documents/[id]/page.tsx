import { notFound } from "next/navigation";
import Link from "next/link";
import { createPortalServerClient } from "@/lib/supabase-portal/server";
import { createCheckoutSession } from "./actions";
import SignaturePad from "./SignaturePad";
import ContractView from "./ContractView";
import SubmitButton from "../../../(internal)/SubmitButton";
import { buttonClass, headingClass, subTextClass } from "../../../(internal)/ui";

// Illustrative only — no real lender is wired up yet (see Phase 1 plan notes).
// Standard amortizing-loan formula at a representative APR.
const ILLUSTRATIVE_APR = 9.99;
const FINANCING_TERMS_MONTHS = [12, 24, 36];

function estimateMonthlyPayment(principal: number, termMonths: number) {
  const monthlyRate = ILLUSTRATIVE_APR / 100 / 12;
  const payment =
    (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -termMonths));
  return Math.round(payment);
}

type LineItem = {
  category: string;
  description: string;
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

export default async function PortalDocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createPortalServerClient();

  const { data: doc, error } = await supabase
    .from("documents")
    .select("*, properties(address)")
    .eq("id", id)
    .single();

  if (error || !doc) notFound();

  if (doc.type === "contract") {
    return <ContractView doc={doc} />;
  }

  const lineData = doc.line_items as {
    items: LineItem[];
    brand: { good: string | null; better: string | null; best: string | null };
    mass_save_eligible: boolean;
    mass_save_note: string | null;
    totals: { good: number; better: number; best: number };
    pricing_mode?: "tiered" | "flat";
  };
  const isFlat = lineData.pricing_mode === "flat";

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={headingClass}>
          {doc.doc_number} — {typeLabel[doc.type]}
        </h1>
        <p className={subTextClass}>
          {doc.properties?.address ? `${doc.properties.address} · ` : ""}
          {new Date(doc.created_at).toLocaleDateString()}
        </p>
      </div>

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

      {(doc.type === "estimate" || doc.type === "proposal") && lineData.totals.better > 0 && (
        <div className="rounded-xl border border-white/8 bg-white/3 p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-g300">
            Financing options
          </div>
          <div className="mt-2 grid grid-cols-3 gap-3 text-center">
            {FINANCING_TERMS_MONTHS.map((term) => (
              <div key={term}>
                <div className="font-display text-lg font-extrabold text-white">
                  {formatPrice(estimateMonthlyPayment(lineData.totals.better, term))}/mo
                </div>
                <div className="text-xs text-g300">{term} months</div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-g500">
            Estimate only, based on the {isFlat ? "quoted" : "Better tier"} price at {ILLUSTRATIVE_APR}%
            illustrative APR — not a credit offer or pre-qualification.
          </p>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-white/8">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/8 text-left text-[10px] font-bold uppercase tracking-wide text-g300">
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2">Qty</th>
              <th className="px-3 py-2">{isFlat ? "Price" : "Price (selected tier)"}</th>
            </tr>
          </thead>
          <tbody>
            {lineData.items.map((item, i) => (
              <tr key={i} className="border-b border-white/8 last:border-0">
                <td className="px-3 py-2 align-top">
                  <div className="font-medium text-white">{item.description}</div>
                  <div className="text-xs text-g300">{item.category}</div>
                </td>
                <td className="px-3 py-2 align-top">
                  {item.qty} {item.unit}
                </td>
                <td className="px-3 py-2 align-top">{formatPrice(item.better)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {doc.type === "invoice" && doc.status !== "paid" && (
        <form action={createCheckoutSession} className="rounded-xl border border-white/8 bg-white/3 p-4">
          <input type="hidden" name="document_id" value={doc.id} />
          <p className={subTextClass}>
            Amount due: <span className="text-white">{formatPrice(doc.total)}</span>
          </p>
          <SubmitButton className={`${buttonClass} mt-3 w-fit`} pendingText="Redirecting…">
            Pay Now
          </SubmitButton>
        </form>
      )}
      {doc.status === "paid" && (
        <div className="rounded-xl border border-green/30 bg-green-l/10 p-4 text-sm text-green">
          Paid{doc.paid_at ? ` on ${new Date(doc.paid_at).toLocaleDateString()}` : ""}.
        </div>
      )}

      {doc.type === "estimate" && doc.status === "sent" && (
        <SignaturePad documentId={doc.id} />
      )}
      {doc.type === "estimate" && doc.status === "approved" && (
        <div className="rounded-xl border border-green/30 bg-green-l/10 p-4 text-sm text-green">
          Approved{doc.signed_at ? ` on ${new Date(doc.signed_at).toLocaleDateString()}` : ""}.
          We&apos;ll be in touch to schedule the work.
        </div>
      )}

      <Link href="/portal" className={subTextClass}>
        &larr; Back to dashboard
      </Link>
    </div>
  );
}
