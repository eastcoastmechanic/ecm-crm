// Good / Better / Best choice on an estimate. The customer picks one in the
// portal when approving; it is stored in documents.selected_tier (SQL 0062)
// and the document total becomes that option's total. Its own column so the
// approval never rewrites line_items an office edit may have just changed.
// Pure helpers, no I/O.

export const TIERS = ["good", "better", "best"] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_LABEL: Record<Tier, string> = { good: "Good", better: "Better", best: "Best" };

export type TierTotals = { good: number; better: number; best: number };

export function parseTier(value: unknown): Tier | null {
  return typeof value === "string" && (TIERS as readonly string[]).includes(value) ? (value as Tier) : null;
}

/** The option the customer chose, or null for flat estimates and ones approved before this existed. */
export function selectedTier(pricingMode: string | null | undefined, storedTier: unknown): Tier | null {
  if (pricingMode === "flat") return null;
  return parseTier(storedTier);
}

/** Total to store on the document: the chosen option's total, otherwise Better (the long-standing default). */
export function documentTotal(totals: TierTotals, tier: Tier | null): number {
  return tier ? totals[tier] : totals.better;
}

/** Options the customer can pick: only ones with a price. */
export function availableTiers(totals: TierTotals): Tier[] {
  return TIERS.filter((t) => Number(totals?.[t]) > 0);
}

type TieredLine = { good: number | null; better: number | null; best: number | null };

/**
 * Once an option is picked, a document shows only that option: every line and
 * total carries the picked price, and it renders like a one-price document.
 */
export function collapseToTier<L extends TieredLine>(
  data: {
    line_items: L[];
    totals: TierTotals;
    brand: { good: string | null; better: string | null; best: string | null };
  },
  tier: Tier
) {
  const price = data.totals[tier];
  const brand = data.brand?.[tier] ?? null;
  return {
    line_items: data.line_items.map((l) => ({ ...l, good: l[tier], better: l[tier], best: l[tier] })),
    totals: { good: price, better: price, best: price },
    brand: { good: brand, better: brand, best: brand },
    pricing_mode: "flat" as const,
    chosen_option: TIER_LABEL[tier],
  };
}

export type OfficeTierResult = { ok: true; tier: Tier | null } | { ok: false; error: string };

/**
 * The pick to store when the office saves a document from the CRM (e.g. the
 * customer approved over the phone). Only estimates carry a pick, and only
 * while approved. Moving one back to draft/sent clears it so the portal asks
 * again. Approving a tiered estimate needs a priced option, except an old
 * estimate that was already approved before picks existed.
 */
export function officeTierUpdate(input: {
  type: string;
  pricingMode: string | null | undefined;
  newStatus: string;
  prevStatus: string;
  prevTier: unknown;
  picked: unknown;
  totals: TierTotals;
}): OfficeTierResult {
  const prevTier = parseTier(input.prevTier);
  if (input.type !== "estimate") return { ok: true, tier: prevTier };
  if (input.pricingMode === "flat" || input.newStatus === "draft" || input.newStatus === "sent") return { ok: true, tier: null };
  if (input.newStatus !== "approved") return { ok: true, tier: prevTier };
  const picked = parseTier(input.picked);
  const tier = picked ?? prevTier;
  if (!tier) {
    if (input.prevStatus === "approved") return { ok: true, tier: null };
    return { ok: false, error: "Pick which option the customer chose (Good, Better or Best) before marking it approved." };
  }
  if (!availableTiers(input.totals).includes(tier)) {
    return { ok: false, error: `The ${TIER_LABEL[tier]} option has no price on this estimate. Pick another or add prices.` };
  }
  return { ok: true, tier };
}

export type ApprovalChoice = { ok: true; tier: Tier | null; total: number } | { ok: false; error: string };

/**
 * What approving this estimate means for the stored total. Flat estimates
 * have one price, so no choice. Tiered ones need a priced option picked.
 */
export function approvalChoice(
  lineItems: { pricing_mode?: string | null; totals?: TierTotals | null } | null | undefined,
  tierInput: unknown
): ApprovalChoice {
  const totals = lineItems?.totals ?? { good: 0, better: 0, best: 0 };
  if (lineItems?.pricing_mode === "flat") return { ok: true, tier: null, total: totals.better };
  const tier = parseTier(tierInput);
  if (!tier) return { ok: false, error: "Pick Good, Better or Best before signing." };
  if (!availableTiers(totals).includes(tier)) return { ok: false, error: "That option isn't available on this estimate." };
  return { ok: true, tier, total: totals[tier] };
}

/**
 * Good / Better / Best totals for a set of line items: price x qty, summed,
 * rounded to cents. A line with no price for an option adds nothing to it.
 * Shared by the CRM editor save and AI document generation.
 */
export function tierTotals(items: { qty: number; good: number | null; better: number | null; best: number | null }[]): TierTotals {
  const sum = (tier: Tier) =>
    Math.round(items.reduce((total, item) => (item[tier] === null ? total : total + item[tier] * item.qty), 0) * 100) / 100;
  return { good: sum("good"), better: sum("better"), best: sum("best") };
}
