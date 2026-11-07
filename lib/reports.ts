// Owner reports (/analytics): profit per job, revenue by service type, lead
// sources, tech hours. Pure rules, no database, so they can be tested. The page
// does the reads. Nothing here guesses a missing number: a job with no price,
// no parts cost or no hours says so instead of counting it as zero.

import { etDateKey } from "@/lib/tz";
import { hoursBetween } from "@/lib/time-clock-rules";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** "2026-11" for an instant, by the New York calendar (not UTC). */
export function etMonthKey(iso: string): string {
  return etDateKey(new Date(iso)).slice(0, 7);
}

export type CostLine = {
  qty: number | null;
  good?: number | null;
  better?: number | null;
  best?: number | null;
  cost?: number | null;
};

/**
 * Parts and materials cost from a document's line items (internal `cost` is per
 * unit). `incomplete` is true when a line with a sell price has no cost on file,
 * so the total is "cost we know", not a claim the rest was free.
 */
export function partsCost(items: CostLine[]): { cost: number; incomplete: boolean } {
  let cost = 0;
  let incomplete = false;
  for (const item of items) {
    const qty = item.qty ?? 1;
    const sells = (item.good ?? 0) > 0 || (item.better ?? 0) > 0 || (item.best ?? 0) > 0;
    if (item.cost === null || item.cost === undefined) {
      if (sells) incomplete = true;
      continue;
    }
    cost += item.cost * qty;
  }
  return { cost: r2(cost), incomplete };
}

/**
 * Parts cost across the documents that price a job. Each entry is that
 * document's line items, or null when it has none (a contract made without an
 * estimate). No lists at all gives null ("no parts list"); some missing marks
 * the total incomplete.
 */
export function partsCostFromDocs(lists: (CostLine[] | null)[]): { cost: number; incomplete: boolean } | null {
  const known = lists.filter((l): l is CostLine[] => Array.isArray(l));
  if (known.length === 0) return null;
  const sum = partsCost(known.flat());
  return { cost: sum.cost, incomplete: sum.incomplete || known.length < lists.length };
}

export type TimeEntry ={ job_id: string; started_at: string; ended_at: string | null };

/** Clocked hours per job from finished job timer entries (work and drive). Open entries are skipped. */
export function hoursByJob(entries: TimeEntry[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const e of entries) {
    if (!e.ended_at) continue;
    map.set(e.job_id, (map.get(e.job_id) ?? 0) + hoursBetween(e.started_at, e.ended_at));
  }
  for (const [k, v] of map) map.set(k, r2(v));
  return map;
}

export type JobProfitInput = {
  /** Sell price for the job, in dollars. Null when no document is linked. */
  price: number | null;
  parts: { cost: number; incomplete: boolean } | null;
  /** Clocked hours, or the finish-time tracked hours. Null or 0 when none. */
  hours: number | null;
  /** HOURLY_LABOR_RATE. Null when it is not set. */
  hourlyRate: number | null;
};

export type JobProfit = {
  price: number | null;
  parts: number | null;
  labor: number | null;
  profit: number | null;
  margin: number | null;
  /** Plain reasons the number is missing or partial. */
  gaps: string[];
};

export function jobProfit(input: JobProfitInput): JobProfit {
  const gaps: string[] = [];
  if (input.price === null) gaps.push("no price linked");
  if (!input.parts) gaps.push("no parts list");
  else if (input.parts.incomplete) gaps.push("some part costs missing");
  const hours = input.hours && input.hours > 0 ? input.hours : null;
  if (hours === null) gaps.push("no hours");
  if (hours !== null && input.hourlyRate === null) gaps.push("labor rate not set");

  const parts = input.parts ? input.parts.cost : null;
  const labor = hours !== null && input.hourlyRate !== null ? r2(hours * input.hourlyRate) : null;
  if (input.price === null) return { price: null, parts, labor, profit: null, margin: null, gaps };

  const profit = r2(input.price - (parts ?? 0) - (labor ?? 0));
  const margin = input.price > 0 ? Math.round((profit / input.price) * 1000) / 10 : null;
  return { price: input.price, parts, labor, profit, margin, gaps };
}

export const NOT_LINKED = "Not linked to a job";

/** Paid revenue grouped by the job type it belongs to; unlinked money is its own row, not dropped. */
export function revenueByType(
  paid: { total: number | null; jobType: string | null }[]
): { type: string; count: number; total: number }[] {
  const map = new Map<string, { count: number; total: number }>();
  for (const p of paid) {
    if (!p.total) continue;
    const key = p.jobType ?? NOT_LINKED;
    const entry = map.get(key) ?? { count: 0, total: 0 };
    entry.count++;
    entry.total += p.total;
    map.set(key, entry);
  }
  return [...map.entries()]
    .map(([type, v]) => ({ type, count: v.count, total: r2(v.total) }))
    .sort((a, b) => (a.type === NOT_LINKED ? 1 : b.type === NOT_LINKED ? -1 : b.total - a.total));
}

export const LEAD_REPORT_STAGES = ["new", "contacted", "quoted", "won", "lost"] as const;

export type LeadSourceRow = {
  source: string;
  total: number;
  stages: Record<(typeof LEAD_REPORT_STAGES)[number] | "other", number>;
  /** Won out of leads that reached an outcome (won or lost). Null with no outcomes yet. */
  winRate: number | null;
};

export function leadSources(leads: { source: string | null; status: string | null }[]): LeadSourceRow[] {
  const map = new Map<string, LeadSourceRow>();
  for (const lead of leads) {
    const source = lead.source || "unknown";
    const row =
      map.get(source) ??
      ({ source, total: 0, stages: { new: 0, contacted: 0, quoted: 0, won: 0, lost: 0, other: 0 }, winRate: null } as LeadSourceRow);
    row.total++;
    const stage = (LEAD_REPORT_STAGES as readonly string[]).includes(lead.status ?? "")
      ? (lead.status as (typeof LEAD_REPORT_STAGES)[number])
      : "other";
    row.stages[stage]++;
    map.set(source, row);
  }
  for (const row of map.values()) {
    const decided = row.stages.won + row.stages.lost;
    row.winRate = decided > 0 ? Math.round((row.stages.won / decided) * 100) : null;
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}
