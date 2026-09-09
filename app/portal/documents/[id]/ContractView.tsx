import Link from "next/link";
import ContractSignaturePad from "./ContractSignaturePad";
import { subTextClass } from "../../../(internal)/ui";
import { BrandedFormShell } from "@/lib/branded-form-shell";
import { COMPANY_NAME, COMPANY_ADDRESS, COMPANY_PHONE, HIC_REGISTRATION_NUMBER } from "@/lib/brand";
import { RIGHT_TO_CANCEL_NOTICE, ARBITRATION_NOTICE_TEXT, GOVERNING_TERMS_TEXT, noticeOfCancellationText } from "@/lib/contract-terms";
import type { ContractLineItems } from "@/lib/contract-terms";

function formatPrice(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value.length === 10 ? `${value}T00:00:00` : value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function PaperSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <h2 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-navy">{title}</h2>
      <div className="whitespace-pre-wrap text-sm leading-relaxed text-g700">{children}</div>
    </section>
  );
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
    <div className="flex flex-col gap-6">
      <BrandedFormShell docType="Contract" docNumber={doc.doc_number} date={transactionDate}>
        <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-highlight">Prepared for</p>
        <p className="font-display text-lg font-bold text-navy">{doc.properties?.address ?? "Property owner"}</p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-g100 bg-white p-3">
            <div className="text-[10px] font-bold uppercase tracking-wide text-g300">Contractor</div>
            <div className="mt-1 font-bold text-navy">{COMPANY_NAME}</div>
            <div className="mt-0.5 text-sm text-g700">{COMPANY_ADDRESS}</div>
            <div className="text-sm text-g700">{COMPANY_PHONE}</div>
            <div className="text-sm text-g700">
              HIC Reg. #: {HIC_REGISTRATION_NUMBER || "Pending — on file with ECM"}
            </div>
          </div>
          <div className="rounded-md border border-g100 bg-white p-3">
            <div className="text-[10px] font-bold uppercase tracking-wide text-g300">Customer (Owner)</div>
            {doc.properties?.address && <div className="mt-1 font-bold text-navy">{doc.properties.address}</div>}
            <div className="text-sm text-g700">{transactionDate}</div>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 rounded-md border border-brand bg-[#eaf7fc] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-g300">Contract Price</div>
            <div className="font-display text-2xl font-bold text-navy">{formatPrice(doc.total)}</div>
          </div>
          <div className="sm:max-w-xs">
            <div className="text-[10px] font-bold uppercase tracking-wide text-g300">Payment Terms</div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-g700">{paymentTerms}</p>
          </div>
        </div>

        <div className="mt-5">
          <PaperSection title="Scope of Work">{scopeOfWork}</PaperSection>
          <PaperSection title="Schedule">
            Start date: {formatDate(startDate)} · Estimated completion: {formatDate(estimatedCompletion)}
          </PaperSection>
          <PaperSection title="Warranty">{warrantyTerms}</PaperSection>
        </div>

        <div className="mb-4 rounded-md border border-accent bg-[#fdf1ee] p-3">
          <div className="text-[11px] font-bold uppercase tracking-wide text-accent">Your Right to Cancel</div>
          <p className="mt-1 text-sm leading-relaxed text-g700">{RIGHT_TO_CANCEL_NOTICE}</p>
        </div>

        <details className="mb-4 rounded-md border border-g100 bg-white p-3">
          <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-wide text-navy">
            Notice of Cancellation (full text)
          </summary>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-g700">
            {noticeOfCancellationText(transactionDate, doc.doc_number)}
          </p>
        </details>

        <PaperSection title="Arbitration & General Terms">
          {ARBITRATION_NOTICE_TEXT}
          {"\n\n"}
          {GOVERNING_TERMS_TEXT}
        </PaperSection>

        <p className="mt-4 text-center text-[11px] text-g300">
          Thank you for the opportunity to earn your business. Questions? Call {COMPANY_PHONE} or visit
          eastcoastmechanical.org.
        </p>
      </BrandedFormShell>

      {doc.status === "sent" && <ContractSignaturePad documentId={doc.id} />}
      {doc.status === "signed" && (
        <div className="rounded-xl border border-green/30 bg-green-l/10 p-4 text-sm text-green">
          Signed{doc.signed_at ? ` on ${new Date(doc.signed_at).toLocaleString()}` : ""}. We'll be
          in touch to schedule the work.
        </div>
      )}

      <Link href="/portal" className={subTextClass}>
        &larr; Back to dashboard
      </Link>
    </div>
  );
}
