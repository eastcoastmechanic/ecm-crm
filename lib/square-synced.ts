import { supabase } from "@/lib/supabase";

// Dashboard numbers read from the tables the Square sync cron keeps up to date
// (every 4 hours), instead of paging the live Square API on every page load.

const OUTSTANDING_STATUSES = ["UNPAID", "PARTIALLY_PAID", "SCHEDULED"];
const PAGE = 1000;

type Totals = { totalCents: number; count: number; syncedAt: string | null };

async function sumPaged<Row extends { synced_at: string }>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
  amount: (row: Row) => number
): Promise<Totals> {
  let totalCents = 0;
  let count = 0;
  let syncedAt: string | null = null;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      totalCents += amount(row);
      count += 1;
      if (!syncedAt || row.synced_at > syncedAt) syncedAt = row.synced_at;
    }
    if ((data?.length ?? 0) < PAGE) break;
  }
  return { totalCents, count, syncedAt };
}

/** Completed Square payments the sync holds (it imports the last 366 days), filtered to the last 365. */
export function getSyncedSquareRevenue(): Promise<Totals> {
  // Rolling 12 months, so rows the sync already holds do not outlive the label.
  const since = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
  return sumPaged<{ total_cents: number; synced_at: string }>(
    (from, to) =>
      supabase
        .from("square_payments")
        .select("total_cents, synced_at")
        .eq("status", "COMPLETED")
        .gte("square_created_at", since)
        .order("id")
        .range(from, to),
    (row) => row.total_cents ?? 0
  );
}

/** Amount still due on sent, unpaid or part-paid Square invoices. Drafts are excluded. */
export function getSyncedSquareMoneyOwed(): Promise<Totals> {
  return sumPaged<{ amount_due_cents: number; synced_at: string }>(
    (from, to) =>
      supabase
        .from("square_invoices")
        .select("amount_due_cents, synced_at")
        .in("status", OUTSTANDING_STATUSES)
        .order("id")
        .range(from, to),
    (row) => row.amount_due_cents ?? 0
  );
}
