"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { deleteDocument } from "./actions";
import { errorClass, inputClass, itemSubClass, itemTitleClass, subTextClass } from "../ui";

const typeLabel: Record<string, string> = {
  estimate: "Estimate",
  invoice: "Invoice",
  proposal: "Proposal",
  assessment: "Condition Assessment",
  warranty: "Warranty",
  mass_save_rebate: "Mass Save Rebate",
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

type Document = {
  id: string;
  doc_number: string | null;
  type: string;
  status: string;
  total: number | null;
  created_at: string;
  customers: { name: string | null } | null;
};

export default function DocumentsList({ documents }: { documents: Document[] }) {
  const [search, setSearch] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return documents;
    return documents.filter((doc) =>
      [doc.doc_number, typeLabel[doc.type], doc.customers?.name, doc.status]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(query))
    );
  }, [documents, search]);

  async function handleDelete(doc: Document) {
    if (!window.confirm(`Delete ${doc.doc_number ?? typeLabel[doc.type]}? This cannot be undone.`)) return;

    setErrors((prev) => ({ ...prev, [doc.id]: "" }));
    setDeletingId(doc.id);
    try {
      const result = await deleteDocument(doc.id);
      if (result.error) {
        setErrors((prev) => ({ ...prev, [doc.id]: result.error! }));
      }
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <input
        type="text"
        placeholder="Search documents…"
        aria-label="Search documents"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className={inputClass}
      />

      <div className="flex flex-col divide-y divide-white/8">
        {filtered.length === 0 && <p className={subTextClass}>No documents match.</p>}
        {filtered.map((doc) => (
          <div key={doc.id} className="flex items-center gap-2 py-3">
            <Link
              href={`/documents/${doc.id}`}
              className="flex min-w-0 flex-1 items-center justify-between gap-4 hover:bg-white/3"
            >
              <div className="min-w-0">
                <div className={itemTitleClass}>
                  {doc.doc_number ?? typeLabel[doc.type]}
                  <span className={`ml-2 ${itemSubClass}`}>{typeLabel[doc.type]}</span>
                </div>
                <div className={itemSubClass}>
                  {doc.customers?.name ?? "Unknown customer"}
                  {" · "}
                  {new Date(doc.created_at).toLocaleDateString()}
                </div>
                {errors[doc.id] && <p className={`mt-1 ${errorClass}`}>{errors[doc.id]}</p>}
              </div>
              <div className="flex flex-shrink-0 items-center gap-3">
                <span className="font-mono text-sm text-white">{formatPrice(doc.total)}</span>
                <span
                  className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    statusClass[doc.status] ?? "bg-white/8 text-g300"
                  }`}
                >
                  {doc.status}
                </span>
              </div>
            </Link>
            <button
              type="button"
              onClick={() => handleDelete(doc)}
              disabled={deletingId === doc.id}
              title="Delete document"
              className="flex-shrink-0 rounded-lg p-2 text-lg opacity-60 transition-opacity hover:opacity-100 disabled:opacity-30"
            >
              🗑️
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
