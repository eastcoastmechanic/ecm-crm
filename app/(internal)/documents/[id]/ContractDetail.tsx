import Link from "next/link";
import { sendDocumentEmail } from "./actions";
import SubmitButton from "../../SubmitButton";
import { headingClass, subTextClass, buttonClass, buttonSecondaryClass, itemSubClass } from "../../ui";
import type { ContractLineItems } from "@/lib/contract-terms";

function formatPrice(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value.length === 10 ? `${value}T00:00:00` : value).toLocaleDateString();
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

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className={headingClass}>{doc.doc_number} — Service Contract</h1>
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

      {doc.status === "signed" && doc.signature_data && (
        <div className="rounded-xl border border-white/8 bg-white p-3 w-fit">
          {/* eslint-disable-next-line @next/next/no-img-element -- a stored signature data URL, not an optimizable remote image */}
          <img src={doc.signature_data} alt="Customer signature" className="h-16" />
        </div>
      )}

      <div className="rounded-xl border border-blue bg-blue/20 p-4 text-center sm:w-64">
        <div className="text-[10px] font-bold uppercase tracking-wide text-g300">Contract Price</div>
        <div className="mt-1 font-display text-xl font-extrabold">{formatPrice(doc.total)}</div>
      </div>

      <section className="flex flex-col gap-2 rounded-xl border border-white/8 p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Scope of Work</h2>
        <p className="text-sm text-white whitespace-pre-wrap">{scopeOfWork}</p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <div className={itemSubClass}>Start date: {formatDate(startDate)}</div>
        <div className={itemSubClass}>Estimated completion: {formatDate(estimatedCompletion)}</div>
      </section>

      <section className="flex flex-col gap-2 rounded-xl border border-white/8 p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Payment Terms</h2>
        <p className="text-sm text-white whitespace-pre-wrap">{paymentTerms}</p>
      </section>

      <section className="flex flex-col gap-2 rounded-xl border border-white/8 p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Warranty</h2>
        <p className="text-sm text-white whitespace-pre-wrap">{warrantyTerms}</p>
      </section>

      {notes && (
        <section className="flex flex-col gap-2 rounded-xl border border-white/8 p-4">
          <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Additional Notes</h2>
          <p className="text-sm text-white whitespace-pre-wrap">{notes}</p>
        </section>
      )}

      <Link href="/documents" className={subTextClass}>
        &larr; Back to documents
      </Link>
    </div>
  );
}
