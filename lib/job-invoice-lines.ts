// Pure math for the draft invoice Finish builds on a job with no contract or estimate price:
// what was done, the clocked labor, and each receipt with the materials markup.
// No database imports, so every case is unit tested (lib/__tests__/job-invoice-lines.test.ts).
//
// Office only: techs never see these lines, the markup or the totals.

import { sumWorkHours } from "@/lib/time-clock-rules";
import { formatMoney } from "@/lib/job-invoice-rules";

// 35% markup per owner, 2026-11-13. MATERIALS_MARKUP_PERCENT on Vercel overrides it.
export const DEFAULT_MATERIALS_MARKUP_PERCENT = 35;

/** The materials markup: MATERIALS_MARKUP_PERCENT when it is a sensible number, else 35. */
export function materialsMarkupPercent(raw: string | null | undefined = process.env.MATERIALS_MARKUP_PERCENT): number {
  const v = (raw ?? "").trim().replace(/%$/, "");
  if (!v) return DEFAULT_MATERIALS_MARKUP_PERCENT;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 500) return DEFAULT_MATERIALS_MARKUP_PERCENT;
  return n;
}

/** HOURLY_LABOR_RATE in dollars, or null when it is not set or not a positive number. */
export function hourlyLaborRate(raw: string | null | undefined = process.env.HOURLY_LABOR_RATE): number | null {
  const n = Number((raw ?? "").trim().replace(/^\$/, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Categories the built draft uses. A draft made only of these is one Finish built. */
export const BUILT_CATEGORY = {
  work: "Work performed",
  labor: "Labor",
  materials: "Materials",
} as const;

export type BuiltLine = {
  category: string;
  description: string;
  price_book_item_name: null;
  qty: number;
  unit: string;
  unit_price: number;
  notes: null;
  /** Office-only cost basis (the receipt amount). Not shown on the invoice. */
  cost: number | null;
};

export type TimeEntryForInvoice = { kind: string; started_at: string; ended_at: string | null; voided_at?: string | null };
export type ReceiptForInvoice = { vendor: string; note: string | null; amount_cents: number | null };

export type JobInvoiceBuild = {
  items: BuiltLine[];
  /** Clocked work hours rounded to the quarter hour (what the labor line bills). */
  laborHours: number;
  totalCents: number;
  /** Things the office should know before sending (no clocked time, rate not set, ...). */
  warnings: string[];
};

/** Nearest quarter hour: 1.12 -> 1, 1.13 -> 1.25, 2.38 -> 2.5. */
export function roundToQuarterHour(hours: number): number {
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  return Math.round(hours * 4) / 4;
}

/** Receipt amount with markup, in whole cents (half a cent rounds up). */
export function markedUpCents(amountCents: number, markupPercent: number): number {
  return Math.round((amountCents * (100 + markupPercent)) / 100);
}

function lineCents(line: Pick<BuiltLine, "qty" | "unit_price">): number {
  return Math.round(line.qty * line.unit_price * 100);
}

function jobLabel(type: string | null | undefined): string {
  if (!type) return "Service";
  return type.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * The draft's lines, in order:
 *  1. what was done: job type and the job's notes, no price;
 *  2. labor: clocked work hours on the job (voided and still-open timers skipped, drive time not
 *     billed), rounded to the quarter hour, times HOURLY_LABOR_RATE. Left out with no hours;
 *     priced at $0 with a warning when the rate is not set;
 *  3. one materials line per receipt: amount x (1 + markup %), rounded to the cent.
 */
export function buildJobInvoiceLines(input: {
  jobType: string | null;
  jobNotes: string | null;
  timeEntries: TimeEntryForInvoice[];
  hourlyRate: number | null;
  receipts: ReceiptForInvoice[];
  markupPercent: number;
}): JobInvoiceBuild {
  const items: BuiltLine[] = [];
  const warnings: string[] = [];

  const notes = (input.jobNotes ?? "").replace(/\s+/g, " ").trim();
  items.push({
    category: BUILT_CATEGORY.work,
    description: `${jobLabel(input.jobType)} job${notes ? `: ${notes}` : ""}`.slice(0, 500),
    price_book_item_name: null,
    qty: 1,
    unit: "ea",
    unit_price: 0,
    notes: null,
    cost: null,
  });

  const laborHours = roundToQuarterHour(sumWorkHours(input.timeEntries.map((e) => ({ ...e, voided_at: e.voided_at ?? null }))));
  if (laborHours === 0) {
    warnings.push("No clocked work time on this job, so there is no labor line. Add it by hand if work was done.");
  } else {
    if (input.hourlyRate == null) warnings.push("HOURLY_LABOR_RATE is not set, so labor is at $0. Set the rate on the line.");
    const rate = input.hourlyRate ?? 0;
    items.push({
      category: BUILT_CATEGORY.labor,
      description: `Labor: ${laborHours} ${laborHours === 1 ? "hr" : "hrs"}${rate ? ` at ${formatMoney(Math.round(rate * 100))}/hr` : ""}`,
      price_book_item_name: null,
      qty: laborHours,
      unit: "hr",
      unit_price: rate,
      notes: null,
      cost: null,
    });
  }

  for (const r of input.receipts) {
    const vendor = r.vendor.trim() || "receipt";
    const note = (r.note ?? "").replace(/\s+/g, " ").trim();
    if (r.amount_cents == null) warnings.push(`The receipt from ${vendor} has no amount, so its line is $0.`);
    const cents = r.amount_cents == null ? 0 : markedUpCents(Math.max(0, r.amount_cents), input.markupPercent);
    items.push({
      category: BUILT_CATEGORY.materials,
      description: `Materials: ${vendor}${note ? ` (${note})` : ""}`.slice(0, 300),
      price_book_item_name: null,
      qty: 1,
      unit: "ea",
      unit_price: cents / 100,
      notes: null,
      cost: r.amount_cents == null ? null : r.amount_cents / 100,
    });
  }

  return { items, laborHours, totalCents: items.reduce((s, l) => s + lineCents(l), 0), warnings };
}

/**
 * True when the draft is Finish's own build: it has the "Work performed" line (a service-report
 * invoice never does, even a labor-only one) and every line is one the build makes.
 */
export function isBuiltDraft(items: { category?: string | null }[] | null | undefined): boolean {
  if (!Array.isArray(items) || items.length === 0) return false;
  const built = new Set<string>(Object.values(BUILT_CATEGORY));
  return items.some((i) => i?.category === BUILT_CATEGORY.work) && items.every((i) => built.has(i?.category ?? ""));
}

/**
 * Drafts Recalculate may rebuild: Finish's labor-and-receipts build, the contract balance line
 * (Finish or Create invoice), or a draft with no lines. A service-report invoice (Parts / Labor,
 * which also carries balance_for_job_id) is none of these, so its lines are never overwritten.
 */
export function isRebuildableDraft(items: { category?: string | null }[] | null | undefined): boolean {
  if (!Array.isArray(items) || items.length === 0) return true;
  if (isBuiltDraft(items)) return true;
  return items.every((i) => i?.category === "Contract balance");
}
