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
