// Pure helpers for plan visit schedules. Months are calendar months 1-12.

/** Josh's default for new plans: AC tune-up in April, heating tune-up in October. */
export const DEFAULT_VISIT_MONTHS = [4, 10];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function monthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? String(month);
}

/** What the visit is called on the job and in lists. April and October carry Josh's tune-up names. */
export function visitLabel(month: number): string {
  if (month === 4) return "AC tune-up";
  if (month === 10) return "Heating tune-up";
  return "Maintenance visit";
}

/** "4, 10" -> [4, 10]. Blank -> null. Throws on anything that is not a month number. */
export function parseVisitMonths(raw: string | null | undefined): number[] | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  const months = text.split(/[,\s]+/).filter(Boolean).map(Number);
  if (months.some((m) => !Number.isInteger(m) || m < 1 || m > 12)) {
    throw new Error("Visit months must be numbers from 1 to 12, like 4, 10");
  }
  return [...new Set(months)].sort((a, b) => a - b);
}

/**
 * The visit due in the month of `todayKey` (YYYY-MM-DD, New York), or null.
 * Nothing is due before the plan starts or after it ends.
 */
export function visitDueNow(opts: {
  visitMonths: number[] | null | undefined;
  startDate: string | null;
  endDate: string | null;
  todayKey: string;
}): { year: number; month: number } | null {
  const { visitMonths, startDate, endDate, todayKey } = opts;
  if (!visitMonths || visitMonths.length === 0) return null;
  const [year, month] = todayKey.split("-").map(Number);
  if (!visitMonths.includes(month)) return null;
  const monthEnd = `${todayKey.slice(0, 7)}-31`;
  if (startDate && startDate > monthEnd) return null;
  if (endDate && endDate < `${todayKey.slice(0, 7)}-01`) return null;
  return { year, month };
}

/** True when a visit's due month is before the month of `todayKey`. */
export function visitOverdue(dueYear: number, dueMonth: number, todayKey: string): boolean {
  const [year, month] = todayKey.split("-").map(Number);
  return dueYear * 12 + dueMonth < year * 12 + month;
}
