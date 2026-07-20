import { notFound } from "next/navigation";
import Link from "next/link";
import { createPortalServerClient } from "@/lib/supabase-portal/server";
import { createCheckoutSession } from "./actions";
import { buttonClass, headingClass, subTextClass } from "../../../(internal)/ui";

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

  const lineData = doc.line_items as {
    items: LineItem[];
    brand: { good: string | null; better: string | null; best: string | null };
    mass_save_eligible: boolean;
    mass_save_note: string | null;
    totals: { good: number; better: number; best: number };
  };

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

      <div className="grid grid-cols-3 gap-3">
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

      <div className="overflow-x-auto rounded-xl border border-white/8">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/8 text-left text-[10px] font-bold uppercase tracking-wide text-g300">
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2">Qty</th>
              <th className="px-3 py-2">Price (selected tier)</th>
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
          <button type="submit" className={`${buttonClass} mt-3 w-fit`}>
            Pay Now
          </button>
        </form>
      )}
      {doc.status === "paid" && (
        <div className="rounded-xl border border-green/30 bg-green-l/10 p-4 text-sm text-green">
          Paid{doc.paid_at ? ` on ${new Date(doc.paid_at).toLocaleDateString()}` : ""}.
        </div>
      )}

      <Link href="/portal" className={subTextClass}>
        &larr; Back to dashboard
      </Link>
    </div>
  );
}
