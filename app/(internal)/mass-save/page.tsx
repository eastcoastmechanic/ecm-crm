import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { headingClass, itemSubClass, itemTitleClass, subTextClass } from "../ui";

export const dynamic = "force-dynamic";

function formatPrice(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

const statusLabel: Record<string, string> = {
  draft: "Draft — not yet sent",
  sent: "Sent — awaiting customer",
  approved: "Approved — ready to file",
  paid: "Paid",
};

export default async function MassSavePage() {
  const { data: docs, error } = await supabase
    .from("documents")
    .select("id, doc_number, type, status, total, created_at, customers(name), line_items")
    .order("created_at", { ascending: false });

  const eligible = (docs ?? []).filter((doc) => {
    const lineItems = doc.line_items as { mass_save_eligible?: boolean } | null;
    return lineItems?.mass_save_eligible === true;
  });

  const byStatus = new Map<string, typeof eligible>();
  for (const doc of eligible) {
    const list = byStatus.get(doc.status) ?? [];
    list.push(doc);
    byStatus.set(doc.status, list);
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={headingClass}>MassSave Rebate Tracker</h1>
        <p className={subTextClass}>
          Every document flagged rebate-eligible by the AI generator, grouped by status so nothing
          gets lost before filing.
        </p>
      </div>

      {error && <p className={itemSubClass}>Error loading documents: {error.message}</p>}

      {["draft", "sent", "approved", "paid"].map((status) => {
        const list = byStatus.get(status) ?? [];
        if (list.length === 0) return null;
        return (
          <section key={status} className="flex flex-col gap-2">
            <h2 className="text-xs font-bold uppercase tracking-wide text-g300">
              {statusLabel[status] ?? status} ({list.length})
            </h2>
            <div className="flex flex-col divide-y divide-white/8">
              {list.map((doc) => {
                const customers = doc.customers as unknown as { name: string | null }[] | null;
                return (
                  <Link
                    key={doc.id}
                    href={`/documents/${doc.id}`}
                    className="flex items-center justify-between gap-4 py-3 hover:bg-white/3"
                  >
                    <div>
                      <div className={itemTitleClass}>
                        {doc.doc_number} — {customers?.[0]?.name ?? "Unknown"}
                      </div>
                      <div className={itemSubClass}>{new Date(doc.created_at).toLocaleDateString()}</div>
                    </div>
                    <div className="font-mono text-sm text-white">{formatPrice(doc.total)}</div>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}

      {eligible.length === 0 && !error && (
        <p className={subTextClass}>No MassSave-eligible documents on file yet.</p>
      )}
    </div>
  );
}
