import { supabase } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/fetch-all";
import { isMissingFunctionError } from "@/lib/doc-number";

/**
 * Dashboard money totals:
 *   outstanding = invoices with status "sent" (total and how many)
 *   paid        = every document with status "paid"
 *
 * The page used to fetch the rows and add them up, which silently stopped at
 * 1000 rows. Now it is one SQL sum (document_money_totals(), SQL 0071). Until
 * 0071 is run, the rows are paged and added up here, so nothing is cut off.
 */
export type DocumentMoneyTotals = {
  outstandingTotal: number;
  outstandingCount: number;
  paidTotal: number;
};

type TotalsRow = { outstanding_total: number | string | null; outstanding_count: number | string | null; paid_total: number | string | null };

export function sumTotals(rows: { total: number | string | null }[]): number {
  // Cents, so a few thousand rows don't pick up floating-point drift.
  const cents = rows.reduce((sum, row) => sum + Math.round(Number(row.total ?? 0) * 100), 0);
  return cents / 100;
}

export function totalsFromRpc(data: unknown): DocumentMoneyTotals | null {
  const row = (Array.isArray(data) ? data[0] : data) as TotalsRow | null | undefined;
  if (!row || typeof row !== "object") return null;
  return {
    outstandingTotal: Number(row.outstanding_total ?? 0),
    outstandingCount: Number(row.outstanding_count ?? 0),
    paidTotal: Number(row.paid_total ?? 0),
  };
}

export async function documentMoneyTotals(): Promise<{ totals: DocumentMoneyTotals; error: string | null }> {
  const { data, error } = await supabase.rpc("document_money_totals");
  if (!error) {
    const totals = totalsFromRpc(data);
    if (totals) return { totals, error: null };
  } else if (!isMissingFunctionError(error)) {
    return { totals: { outstandingTotal: 0, outstandingCount: 0, paidTotal: 0 }, error: error.message };
  }

  // 0071 not run yet: page through the rows and add them up here.
  const [outstanding, paid] = await Promise.all([
    fetchAllRows<{ total: number | null }>((from, to) =>
      supabase.from("documents").select("total").eq("type", "invoice").eq("status", "sent").order("id").range(from, to)
    ),
    fetchAllRows<{ total: number | null }>((from, to) =>
      supabase.from("documents").select("total").eq("status", "paid").order("id").range(from, to)
    ),
  ]);
  return {
    totals: {
      outstandingTotal: sumTotals(outstanding.data),
      outstandingCount: outstanding.data.length,
      paidTotal: sumTotals(paid.data),
    },
    error: outstanding.error ?? paid.error,
  };
}
