import { notFound } from "next/navigation";
import Link from "next/link";
import { supabase as adminDb } from "@/lib/supabase";
import { one } from "@/lib/appointment-reminder";
import { portalCustomerFor, requirePortalUser } from "@/lib/portal-customer";
import { formatPortalDate, portalContractTerms, portalPmReport, portalPricedLines } from "@/lib/portal-view";
import PayNowForm from "./PayNowForm";
import SignaturePad from "./SignaturePad";
import ContractView from "./ContractView";
import { headingClass, subTextClass } from "../../../(internal)/ui";
import { availableTiers, selectedTier, TIER_LABEL } from "@/lib/estimate-tier";
import { loadDepositContract, offeredDepositCents } from "@/lib/online-deposit";

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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ deposit?: string }>;
}) {
  const { id } = await params;
  const { deposit: depositReturn } = await searchParams;
  const user = await requirePortalUser();
  const customer = await portalCustomerFor(user.id);
  if (!customer) notFound();

  // Read on the server with the service client, scoped to this customer, never
  // a draft, and only the columns this page shows. line_items is narrowed below
  // (portal-view.ts) so internal fields like a line's cost never reach the page.
  const { data: row, error } = await adminDb
    .from("documents")
    .select("id, doc_number, type, status, total, created_at, signed_at, paid_at, selected_tier, line_items, properties(address)")
    .eq("id", id)
    .eq("customer_id", customer.id)
    .neq("status", "draft")
    .maybeSingle();

  if (error || !row) notFound();

  const { line_items: rawLineItems, properties, ...fields } = row;
  const doc = { ...fields, properties: one(properties as { address: string | null } | { address: string | null }[] | null) };

  if (doc.type === "contract") {
    // Deposit state comes from the server too; the amount is the one in the signed terms.
    const { doc: depositRow, ready } = await loadDepositContract(doc.id, customer.id);
    const deposit = {
      dueCents: depositRow ? offeredDepositCents(depositRow, ready) : null,
      receivedCents: depositRow?.deposit_received_cents ?? null,
      // Back from Stripe before the webhook landed: say so instead of offering a second payment.
      justPaid: depositReturn === "1",
    };
    return <ContractView doc={{ ...doc, line_items: portalContractTerms(rawLineItems) }} deposit={deposit} />;
  }

  if (doc.type === "pm_report") {
    const snapshot = portalPmReport(rawLineItems);
    const failures = snapshot.failures;
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className={headingClass}>Maintenance report {doc.doc_number ?? ""}</h1>
          <p className={subTextClass}>
            {doc.properties?.address ? `${doc.properties.address} · ` : ""}
            {formatPortalDate(doc.created_at)}
          </p>
        </div>
        {snapshot.summary && (
          <p className={subTextClass}>
            Pass {snapshot.summary.pass} · Fail {snapshot.summary.fail} · N/A {snapshot.summary.na}
          </p>
        )}
        {failures.length > 0 && (
          <ul className="grid gap-2 text-sm">
            {failures.map((item, i) => (
              <li key={item.key ?? item.label ?? i}>
                {item.section ? `${item.section} — ` : ""}
                {item.label}
                {item.notes ? `. ${item.notes}` : ""}
              </li>
            ))}
          </ul>
        )}
        {snapshot.recommendations ? <p className="text-sm text-white">{snapshot.recommendations}</p> : null}
      </div>
    );
  }

  const lineData = portalPricedLines(rawLineItems);
  const isFlat = lineData.pricing_mode === "flat";
  const chosen = selectedTier(lineData.pricing_mode, doc.selected_tier);
  // Line prices follow the customer's pick once they've chosen; Better until then.
  const priceTier = chosen ?? "better";
  const tierOptions =
    doc.type === "estimate" && !isFlat
      ? availableTiers(lineData.totals).map((t) => ({ tier: t, total: lineData.totals[t], brand: lineData.brand?.[t] ?? null }))
      : [];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={headingClass}>
          {doc.doc_number} — {typeLabel[doc.type]}
        </h1>
        <p className={subTextClass}>
          {doc.properties?.address ? `${doc.properties.address} · ` : ""}
          {formatPortalDate(doc.created_at)}
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
                chosen
                  ? tier === chosen
                    ? "border-green bg-green-l/10"
                    : "border-white/8 bg-white/3 opacity-60"
                  : tier === "better"
                    ? "border-blue bg-blue/20"
                    : tier === "best"
                      ? "border-accent/40 bg-accent/10"
                      : "border-white/8 bg-white/3"
              }`}
            >
              <div className="text-[10px] font-bold uppercase tracking-wide text-g300">
                {tier === chosen ? `${TIER_LABEL[tier]}: your choice` : tier === "better" ? "Better ★" : tier}
              </div>
              <div className="mt-1 font-display text-xl font-extrabold">
                {formatPrice(lineData.totals[tier])}
              </div>
              <div className="mt-1 text-xs text-g300">{lineData.brand?.[tier] || "—"}</div>
            </div>
          ))}
        </div>
      )}

      {(doc.type === "estimate" || doc.type === "proposal") && lineData.totals[priceTier] > 0 && (
        <div className="rounded-xl border border-white/8 bg-white/3 p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-g300">
            Financing options
          </div>
          <div className="mt-2 grid grid-cols-3 gap-3 text-center">
            {FINANCING_TERMS_MONTHS.map((term) => (
              <div key={term}>
                <div className="font-display text-lg font-extrabold text-white">
                  {formatPrice(estimateMonthlyPayment(lineData.totals[priceTier], term))}/mo
                </div>
                <div className="text-xs text-g300">{term} months</div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-g500">
            Estimate only, based on the {isFlat ? "quoted" : `${TIER_LABEL[priceTier]} option`} price at {ILLUSTRATIVE_APR}%
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
              <th className="px-3 py-2">{isFlat ? "Price" : `Price (${TIER_LABEL[priceTier]})`}</th>
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
                <td className="px-3 py-2 align-top">{formatPrice(item[priceTier])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {doc.type === "invoice" && doc.status !== "paid" && (
        <PayNowForm documentId={doc.id} amount={formatPrice(doc.total)} />
      )}
      {doc.status === "paid" && (
        <div className="rounded-xl border border-green/30 bg-green-l/10 p-4 text-sm text-green">
          Paid{doc.paid_at ? ` on ${formatPortalDate(doc.paid_at)}` : ""}.
        </div>
      )}

      {doc.type === "estimate" && doc.status === "sent" && (
        <SignaturePad documentId={doc.id} options={tierOptions} />
      )}
      {doc.type === "estimate" && doc.status === "approved" && (
        <div className="rounded-xl border border-green/30 bg-green-l/10 p-4 text-sm text-green">
          Approved{chosen ? `: ${TIER_LABEL[chosen]} option, ${formatPrice(lineData.totals[chosen])}` : ""}
          {doc.signed_at ? ` on ${formatPortalDate(doc.signed_at)}` : ""}.
          We&apos;ll be in touch to schedule the work.
        </div>
      )}

      <Link href="/portal" className={subTextClass}>
        &larr; Back to dashboard
      </Link>
    </div>
  );
}
