// Business time. Vercel runs in UTC, so anything a customer or the owner reads
// (reminder texts, "tomorrow" windows) has to be computed in New York time
// explicitly rather than with the server's local clock.
export const BUSINESS_TZ = "America/New_York";

/** YYYY-MM-DD for the given instant, as the calendar date in New York. */
export function etDateKey(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Add whole calendar days to a YYYY-MM-DD key (no timezone involved). */
export function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// Offset (ms) of New York from UTC at the given instant: negative, -4h or -5h.
function etOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

// The UTC instant of 00:00 New York time on the given calendar date.
function etMidnight(dateKey: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  const wallAsUtc = Date.UTC(y, m - 1, d, 0, 0, 0);
  // Midnight is never skipped in New York (DST changes happen at 2am), so two
  // passes converge on the right offset even on the 23/25-hour days.
  let guess = wallAsUtc - etOffsetMs(new Date(wallAsUtc));
  guess = wallAsUtc - etOffsetMs(new Date(guess));
  return new Date(guess);
}

/**
 * UTC instants bounding one New York calendar day: start is inclusive,
 * end is the next midnight and exclusive (use gte start / lt end).
 */
export function etDayRange(dateKey: string): { start: Date; end: Date } {
  return { start: etMidnight(dateKey), end: etMidnight(addDaysToDateKey(dateKey, 1)) };
}

export function formatEtTime(date: Date | string): string {
  return new Date(date).toLocaleTimeString("en-US", {
    timeZone: BUSINESS_TZ,
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatEtDateTime(
  date: Date | string,
  options: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }
): string {
  return new Date(date).toLocaleString("en-US", { timeZone: BUSINESS_TZ, ...options });
}
