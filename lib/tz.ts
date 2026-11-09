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

/** Hour of the day (0-23) in New York at the given instant. */
export function etHour(date: Date = new Date()): number {
  const hour = new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TZ, hourCycle: "h23", hour: "numeric" }).format(date);
  return Number(hour);
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

/** Parse a datetime-local value ("2026-10-22T09:30") as New York wall-clock time. Null if unreadable. */
export function parseEtLocal(value: string): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(value ?? "");
  if (!m) return null;
  const [y, mo, d] = m[1].split("-").map(Number);
  // Resolve the offset at the wall time itself (not at midnight), so the 23/25-hour
  // DST days come out right. Two passes converge on the correct offset.
  const wallAsUtc = Date.UTC(y, mo - 1, d, Number(m[2]), Number(m[3]), 0);
  let when = new Date(wallAsUtc - etOffsetMs(new Date(wallAsUtc)));
  when = new Date(wallAsUtc - etOffsetMs(when));
  return Number.isNaN(when.getTime()) ? null : when;
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

/** Short New York date for report pages, like "11/9/2026". "—" when there is no date. */
export function formatEtShortDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { timeZone: BUSINESS_TZ, month: "numeric", day: "numeric", year: "numeric" });
}

/** Short New York date and time for report pages, like "11/9/2026, 1:20 AM". "—" when there is no date. */
export function formatEtShortDateTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    timeZone: BUSINESS_TZ,
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Calendar date in New York, "11/9/2026" by default. Use in place of a bare
 * `toLocaleDateString()`. A plain "YYYY-MM-DD" value (a date column) is already a
 * calendar date, so it prints as that date and is never shifted a day.
 */
export function formatEtDate(
  date: Date | string,
  options: Intl.DateTimeFormatOptions = { month: "numeric", day: "numeric", year: "numeric" }
): string {
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { ...options, timeZone: "UTC" });
  }
  return new Date(date).toLocaleDateString("en-US", { timeZone: BUSINESS_TZ, ...options });
}

/** A datetime-local input value ("2026-10-22T09:30") for an instant, in New York time. */
export function toEtLocalInput(date: Date | string): string {
  const d = new Date(date);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${etDateKey(d)}T${get("hour")}:${get("minute")}`;
}

/** The instant a New York day ("YYYY-MM-DD") reaches `hour`:00. Null if the date is unreadable. */
export function etDateAtHour(dateKey: string, hour: number): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey ?? "") || !Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  return parseEtLocal(`${dateKey}T${String(hour).padStart(2, "0")}:00`);
}

/**
 * New York datetime-local value for an ISO date/time. With a zone ("Z", "-05:00")
 * it is converted; without one ("2026-11-12T10:00") it is already New York time,
 * not the server's. Null if unreadable.
 */
export function etLocalFromIso(value: string): string | null {
  const trimmed = (value ?? "").trim();
  if (/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed)) {
    const when = new Date(trimmed);
    return Number.isNaN(when.getTime()) ? null : toEtLocalInput(when);
  }
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(trimmed);
  return m && parseEtLocal(`${m[1]}T${m[2]}`) ? `${m[1]}T${m[2]}` : null;
}

/**
 * Move to another New York calendar day ("YYYY-MM-DD"), keeping the New York
 * time of day (an 8 PM job stays 8 PM, across DST too). With no current time,
 * lands at `defaultTime`. Null if the date is unreadable.
 */
export function moveToEtDate(current: Date | string | null, dateKey: string, defaultTime = "09:00"): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const time = current ? toEtLocalInput(current).slice(11) : defaultTime;
  return parseEtLocal(`${dateKey}T${time}`);
}
