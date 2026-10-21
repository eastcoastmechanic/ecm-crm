// Pure helpers for sending a stored estimate to Square. No I/O here so it is
// easy to test. All amounts come from the stored document; nothing is invented.

export type StoredLineItem = {
  description?: string | null;
  qty?: number | string | null;
  unit?: string | null;
  good?: number | string | null;
  better?: number | string | null;
  best?: number | string | null;
};

export type StoredDocument = {
  doc_number: string | null;
  subtotal: number | string | null;
  tax: number | string | null;
  total: number | string | null;
  line_items: {
    items?: StoredLineItem[];
    pricing_mode?: string | null;
    deposit_percent?: number | string | null;
  } | null;
};

export type SquareOrderLine = {
  name: string;
  quantity: string;
  base_price_money: { amount: number; currency: "USD" };
};

export function toCents(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Square caps idempotency keys at 45 chars; prefix + uuid(36) fits. */
export function idempotencyKey(kind: "ord" | "inv" | "cus", id: string): string {
  return `ecm-${kind}-${id}`.slice(0, 45);
}

export type OrderLinesResult =
  | { ok: true; lines: SquareOrderLine[]; totalCents: number }
  | { ok: false; error: string };

/**
 * Map stored line items to Square order lines (cents). Flat-priced estimates
 * only; tiered ones need a human to pick an option first. Fails if the lines
 * plus tax do not add up to the stored total, rather than sending a wrong amount.
 */
export function mapLineItems(doc: StoredDocument): OrderLinesResult {
  const items = doc.line_items?.items ?? [];
  if (items.length === 0) return { ok: false, error: "This estimate has no line items." };
  if (doc.line_items?.pricing_mode && doc.line_items.pricing_mode !== "flat") {
    return { ok: false, error: "This estimate has Good/Better/Best options. Open it and pick one first." };
  }

  const lines: SquareOrderLine[] = [];
  for (const item of items) {
    const qty = Number(item.qty ?? 1);
    if (!Number.isFinite(qty) || qty <= 0) return { ok: false, error: "A line item has a bad quantity." };
    const unitCents = toCents(item.better ?? item.good);
    if (unitCents < 0) return { ok: false, error: "A line item has a negative price." };
    lines.push({
      name: (item.description?.trim() || "Line item").slice(0, 512),
      quantity: String(Math.round(qty * 1000) / 1000),
      base_price_money: { amount: unitCents, currency: "USD" },
    });
  }

  const taxCents = toCents(doc.tax);
  if (taxCents > 0) {
    lines.push({ name: "Sales tax", quantity: "1", base_price_money: { amount: taxCents, currency: "USD" } });
  }

  const sum = lines.reduce((s, l) => s + Math.round(Number(l.quantity) * l.base_price_money.amount), 0);
  const totalCents = toCents(doc.total);
  if (totalCents <= 0) return { ok: false, error: "This estimate has no total." };
  if (Math.abs(sum - totalCents) > 1) {
    return { ok: false, error: "Line items do not add up to the total. Fix it on the document first." };
  }
  return { ok: true, lines, totalCents };
}

export type DepositSplit = { depositCents: number; balanceCents: number; capped: boolean } | null;

/**
 * 50% deposit / 50% completion, with the MA HIC cap used in
 * lib/contract-terms.ts (deposit <= greater of one-third of price or
 * special-order materials cost). Returns null when there is no usable deposit.
 */
export function depositSplit(
  totalCents: number,
  depositPercent: number | string | null | undefined,
  specialOrderCents = 0
): DepositSplit {
  const pct = Number(depositPercent ?? 0);
  if (!Number.isFinite(pct) || pct <= 0 || pct >= 100 || totalCents <= 0) return null;
  const wanted = Math.round((totalCents * pct) / 100);
  const cap = Math.max(Math.round(totalCents / 3), specialOrderCents);
  const depositCents = Math.min(wanted, cap);
  if (depositCents <= 0 || depositCents >= totalCents) return null;
  return { depositCents, balanceCents: totalCents - depositCents, capped: depositCents < wanted };
}

export type PaymentRequestInput = {
  request_type: "DEPOSIT" | "BALANCE";
  due_date: string;
  fixed_amount_requested_money?: { amount: number; currency: "USD" };
  automatic_payment_source: "NONE";
};

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const BALANCE_DUE_DAYS = 30;

export function paymentRequests(split: DepositSplit, today: string): PaymentRequestInput[] {
  const balance: PaymentRequestInput = {
    request_type: "BALANCE",
    due_date: addDays(today, BALANCE_DUE_DAYS),
    automatic_payment_source: "NONE",
  };
  if (!split) return [{ ...balance, due_date: today }];
  return [
    {
      request_type: "DEPOSIT",
      due_date: today,
      fixed_amount_requested_money: { amount: split.depositCents, currency: "USD" },
      automatic_payment_source: "NONE",
    },
    balance,
  ];
}
