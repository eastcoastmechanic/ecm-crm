import Link from "next/link";
import { supabase } from "@/lib/supabase";
import RouteButtons from "./RouteButtons";
import { errorClass, headingClass, itemSubClass, itemTitleClass, subTextClass } from "../../ui";

export const dynamic = "force-dynamic";

type InboxRow = {
  id: string;
  doc_number: string | null;
  total: number | null;
  created_at: string;
  customers: { name: string | null } | null;
  properties: { address: string | null } | null;
};

function formatPrice(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value));
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function EstimateInboxPage() {
  const { data, error } = await supabase
    .from("documents")
    .select("id, doc_number, total, created_at, customers(name), properties(address)")
    .eq("type", "estimate")
    .eq("status", "draft")
    .is("routed_to", null)
    .order("created_at", { ascending: false });

  const rows = (data ?? []) as unknown as InboxRow[];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/documents" className={itemSubClass}>
          ← Documents
        </Link>
        <h1 className={`${headingClass} mt-1 flex items-center gap-3`}>
          Estimates to review
          {rows.length > 0 && (
            <span className="rounded-full bg-accent px-2.5 py-0.5 text-sm font-bold text-white">{rows.length}</span>
          )}
        </h1>
        <p className={subTextClass}>
          Drafts from the bots. Pick where each one goes. Square makes a draft invoice only; you send it from Square.
        </p>
      </div>

      {error && <p className={errorClass}>Error loading estimates: {error.message}</p>}

      {!error && rows.length === 0 && <p className={subTextClass}>Nothing waiting.</p>}

      <div className="flex flex-col gap-3">
        {rows.map((row) => (
          <div
            key={row.id}
            className="flex flex-col gap-3 rounded-xl border border-white/8 bg-white/3 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className={itemTitleClass}>{row.customers?.name ?? "No customer"}</p>
              {row.properties?.address && <p className={itemSubClass}>{row.properties.address}</p>}
              <p className={itemSubClass}>
                <Link href={`/documents/${row.id}`} className="underline">
                  {row.doc_number ?? "Open"}
                </Link>{" "}
                · {formatPrice(row.total)} · {formatWhen(row.created_at)}
              </p>
            </div>
            <RouteButtons documentId={row.id} />
          </div>
        ))}
      </div>
    </div>
  );
}
