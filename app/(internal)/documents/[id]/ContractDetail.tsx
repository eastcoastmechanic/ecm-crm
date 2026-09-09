import Link from "next/link";
import { sendDocumentEmail } from "./actions";
import SubmitButton from "../../SubmitButton";
import { buttonClass, buttonSecondaryClass, subTextClass } from "../../ui";
import DocumentDeleteButton from "../DocumentDeleteButton";
import { BrandedFormShell } from "@/lib/branded-form-shell";
import { COMPANY_NAME, COMPANY_ADDRESS, COMPANY_PHONE, HIC_REGISTRATION_NUMBER } from "@/lib/brand";
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

const statusLabel: Record<string, string> = {
  draft: "Draft — not yet sent",
  sent: "Sent — awaiting signature",
  signed: "Signed",
};

export default function ContractDetail({
  doc,
  hasEmail,
}: {
  doc: {
    id: string;
    doc_number: string | null;
    created_at: string;
    status: string;
    sent_at: string | null;
    signed_at: string | null;
    signature_data: string | null;
    total: number | null;
    customers: { id: string; name: string | null } | null;
    properties: { address: string | null } | null;
    line_items: ContractLineItems;
  };
  hasEmail: boolean;
}) {
  const { scopeOfWork, paymentTerms, warrantyTerms, startDate, estimatedCompletion, notes } = doc.line_items;
  const transactionDate = formatDate(doc.created_at);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <a
          href={`/documents/${doc.id}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonSecondaryClass}
        >
          Download PDF
        </a>
        <DocumentDeleteButton id={doc.id} label="Contract" />
        {doc.status !== "signed" &&
          (hasEmail ? (
            <form action={sendDocumentEmail} className="flex items-center gap-2">
              <input type="hidden" name="id" value={doc.id} />
              <SubmitButton className={buttonClass} pendingText="Sending…">
                {doc.status === "sent" ? "Resend" : "Send to Customer"}
              </SubmitButton>
            </form>
          ) : (
            <span className={subTextClass}>No customer email on file — use Edit to add one</span>
          ))}
      </div>

      <div
        className={`rounded-xl border p-4 text-sm ${
          doc.status === "signed"
            ? "border-green/30 bg-green-l/10 text-green"
            : doc.status === "sent"
              ? "border-blue bg-blue/20 text-white"
              : "border-white/8 bg-white/3 text-g300"
        }`}
      >
        {statusLabel[doc.status] ?? doc.status}
        {doc.status === "signed" && doc.signed_at && ` on ${new Date(doc.signed_at).toLocaleString()}`}
      </div>

      <BrandedFormShell docType="Contract" docNumber={doc.doc_number} date={transactionDate}>
        <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-highlight">Prepared for</p>
        <p className="font-display text-lg font-bold text-navy">
          {doc.customers?.id ? (
            <a href={`/customers/${doc.customers.id}`} className="underline decoration-brand/40 hover:text-brand">
              {doc.customers.name}
            </a>
          ) : (
            doc.customers?.name
          )}
        </p>
        {doc.properties?.address && <p className="text-sm text-g500">{doc.properties.address}</p>}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-g100 bg-white p-3">
            <div className="text-[10px] font-bold uppercase tracking-wide text-g300">Contractor</div>
            <div className="mt-1 font-bold text-navy">{COMPANY_NAME}</div>
            <div className="mt-0.5 text-sm text-g700">{COMPANY_ADDRESS}</div>
            <div className="text-sm text-g700">{COMPANY_PHONE}</div>
            <div className="text-sm text-g700">
              HIC Reg. #: {HIC_REGISTRATION_NUMBER || "NOT SET — see lib/brand.ts"}
            </div>
          </div>
          <div className="rounded-md border border-g100 bg-white p-3">
            <div className="text-[10px] font-bold uppercase tracking-wide text-g300">Customer (Owner)</div>
            <div className="mt-1 font-bold text-navy">{doc.customers?.name}</div>
            {doc.properties?.address && <div className="text-sm text-g700">{doc.properties.address}</div>}
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

        <section className="mt-5 mb-4">
          <h2 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-navy">Scope of Work</h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-g700">{scopeOfWork}</p>
        </section>
        <section className="mb-4 text-sm text-g700">
          Start date: {formatDate(startDate)} · Estimated completion: {formatDate(estimatedCompletion)}
        </section>
        <section className="mb-4">
          <h2 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-navy">Warranty</h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-g700">{warrantyTerms}</p>
        </section>
        {notes && (
          <section className="mb-4">
            <h2 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-navy">Additional Notes</h2>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-g700">{notes}</p>
          </section>
        )}

        {doc.status === "signed" && doc.signature_data && (
          <div className="mb-2 rounded-md border border-g100 bg-white p-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- stored signature data URL */}
            <img src={doc.signature_data} alt="Customer signature" className="h-16" />
          </div>
        )}
      </BrandedFormShell>

      <Link href="/documents" className={subTextClass}>
        &larr; Back to documents
      </Link>
    </div>
  );
}
