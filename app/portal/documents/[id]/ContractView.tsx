import Link from "next/link";
import ContractSignaturePad from "./ContractSignaturePad";
import { headingClass, subTextClass } from "../../../(internal)/ui";
import { RIGHT_TO_CANCEL_NOTICE, ARBITRATION_NOTICE_TEXT, GOVERNING_TERMS_TEXT, noticeOfCancellationText } from "@/lib/contract-terms";
import type { ContractLineItems } from "@/lib/contract-terms";

function formatPrice(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value.length === 10 ? `${value}T00:00:00` : value).toLocaleDateString();
}

export default function ContractView({
  doc,
}: {
  doc: {
    id: string;
    doc_number: string | null;
    created_at: string;
    status: string;
    signed_at: string | null;
    total: number | null;
    properties: { address: string | null } | null;
    line_items: ContractLineItems;
  };
}) {
  const { scopeOfWork, paymentTerms, warrantyTerms, startDate, estimatedCompletion } = doc.line_items;
  const transactionDate = formatDate(doc.created_at);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={headingClass}>{doc.doc_number} — Service Contract</h1>
        <p className={subTextClass}>
          {doc.properties?.address ? `${doc.properties.address} · ` : ""}
          {transactionDate}
        </p>
      </div>

      <div className="rounded-xl border border-blue bg-blue/20 p-4 text-center sm:w-64">
        <div className="text-[10px] font-bold uppercase tracking-wide text-g300">Contract Price</div>
        <div className="mt-1 font-display text-xl font-extrabold">{formatPrice(doc.total)}</div>
      </div>

      <section className="flex flex-col gap-2 rounded-xl border border-white/8 p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Scope of Work</h2>
        <p className="text-sm text-white whitespace-pre-wrap">{scopeOfWork}</p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 text-sm text-white">
        <div>Start date: {formatDate(startDate)}</div>
        <div>Estimated completion: {formatDate(estimatedCompletion)}</div>
      </section>

      <section className="flex flex-col gap-2 rounded-xl border border-white/8 p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Payment Terms</h2>
        <p className="text-sm text-white whitespace-pre-wrap">{paymentTerms}</p>
      </section>

      <section className="flex flex-col gap-2 rounded-xl border border-white/8 p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Warranty</h2>
        <p className="text-sm text-white whitespace-pre-wrap">{warrantyTerms}</p>
      </section>

      <section className="flex flex-col gap-2 rounded-xl border border-accent/30 bg-accent/5 p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-accent">Your Right to Cancel</h2>
        <p className="text-sm text-white whitespace-pre-wrap">{RIGHT_TO_CANCEL_NOTICE}</p>
      </section>

      <details className="rounded-xl border border-white/8 bg-white/3 p-4">
        <summary className="cursor-pointer text-xs font-bold uppercase tracking-wide text-g300">
          Notice of Cancellation (full text)
        </summary>
        <p className="mt-2 text-sm text-white whitespace-pre-wrap">
          {noticeOfCancellationText(transactionDate, doc.doc_number)}
        </p>
      </details>

      <section className="flex flex-col gap-2 rounded-xl border border-white/8 p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Arbitration &amp; General Terms</h2>
        <p className="text-sm text-white whitespace-pre-wrap">{ARBITRATION_NOTICE_TEXT}</p>
        <p className="text-sm text-white whitespace-pre-wrap">{GOVERNING_TERMS_TEXT}</p>
      </section>

      {doc.status === "sent" && <ContractSignaturePad documentId={doc.id} />}
      {doc.status === "signed" && (
        <div className="rounded-xl border border-green/30 bg-green-l/10 p-4 text-sm text-green">
          Signed{doc.signed_at ? ` on ${new Date(doc.signed_at).toLocaleString()}` : ""}. We&apos;ll be
          in touch to schedule the work.
        </div>
      )}

      <Link href="/portal" className={subTextClass}>
        &larr; Back to dashboard
      </Link>
    </div>
  );
}
