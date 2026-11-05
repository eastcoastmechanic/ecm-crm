// Pure money rules for invoicing the balance on a finished job. No database imports,
// so they can be tested on their own.

/** "$1,234.50" or "1234.5" to whole cents. Null when it is not a usable amount. */
export function parseMoneyToCents(raw: string): number | null {
  const cleaned = raw.trim().replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** What is still owed on a contract: total minus the deposit actually received. Never negative. */
export function balanceDueCents(totalCents: number, depositCents: number | null): number {
  return Math.max(0, totalCents - (depositCents ?? 0));
}

export function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}

export function formatMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
