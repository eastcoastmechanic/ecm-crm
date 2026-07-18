import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { buttonClass, errorClass, headingClass, itemSubClass, itemTitleClass, subTextClass } from "../ui";

const typeLabel: Record<string, string> = {
  estimate: "Estimate",
  invoice: "Invoice",
  proposal: "Proposal",
};

const statusClass: Record<string, string> = {
  draft: "bg-white/8 text-g300",
  sent: "bg-blue/40 text-white",
  approved: "bg-green-l text-green",
  paid: "bg-green text-white",
};

function formatPrice(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export default async function DocumentsPage() {
  const { data: documents, error } = await supabase
    .from("documents")
    .select("*, customers(name)")
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className={headingClass}>Documents</h1>
          <p className={subTextClass}>
            AI-generated estimates, invoices, and proposals.
          </p>
        </div>
        <Link href="/documents/new" className={buttonClass}>
          New Document
        </Link>
      </div>

      {error && (
        <p className={errorClass}>Error loading documents: {error.message}</p>
      )}

      <div className="flex flex-col divide-y divide-white/8">
        {documents?.length === 0 && (
          <p className={subTextClass}>No documents yet.</p>
        )}
        {documents?.map((doc) => (
          <Link
            key={doc.id}
            href={`/documents/${doc.id}`}
            className="flex items-center justify-between gap-4 py-3 hover:bg-white/3"
          >
            <div>
              <div className={itemTitleClass}>
                {doc.doc_number ?? typeLabel[doc.type]}
                <span className={`ml-2 ${itemSubClass}`}>{typeLabel[doc.type]}</span>
              </div>
              <div className={itemSubClass}>
                {doc.customers?.name ?? "Unknown customer"}
                {" · "}
                {new Date(doc.created_at).toLocaleDateString()}
              </div>
            </div>
            <div className="flex flex-shrink-0 items-center gap-3">
              <span className="font-mono text-sm text-white">
                {formatPrice(doc.total)}
              </span>
              <span
                className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  statusClass[doc.status] ?? "bg-white/8 text-g300"
                }`}
              >
                {doc.status}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
