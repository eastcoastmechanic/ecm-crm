// Pure rules for the time clock. No database, so they are easy to test.

/** A shift left open longer than this is closed by the daily cleanup and flagged. */
export const SHIFT_CAP_HOURS = 14;
/** A job entry left open longer than this is closed by the daily cleanup and flagged. */
export const ENTRY_CAP_HOURS = 12;
/** Massachusetts: a shift over 6 hours needs a 30 minute meal break (unpaid only if the worker is free of duties). */
export const MEAL_BREAK_AFTER_HOURS = 6;
export const MEAL_BREAK_MINUTES = 30;
/** Overtime starts after this many hours in a work week (Massachusetts: 1.5x over 40). */
export const OVERTIME_AFTER_HOURS = 40;

const HOUR_MS = 3600000;

export function hoursBetween(start: Date | string, end: Date | string): number {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Math.max(0, Math.round((ms / HOUR_MS) * 100) / 100);
}

/** When a stale open row should be closed: its start plus the cap. */
export function autoCloseAt(startedAt: Date | string, capHours: number): Date {
  return new Date(new Date(startedAt).getTime() + capHours * HOUR_MS);
}

export function isStale(startedAt: Date | string, capHours: number, now: Date = new Date()): boolean {
  return now.getTime() - new Date(startedAt).getTime() > capHours * HOUR_MS;
}

/** True when a shift is long enough that a meal break should have been logged. */
export function shiftNeedsBreak(startedAt: Date | string, endedAt: Date | string): boolean {
  return hoursBetween(startedAt, endedAt) > MEAL_BREAK_AFTER_HOURS;
}

/** Paid hours for a shift: elapsed time minus the unpaid break. Never negative. */
export function paidShiftHours(startedAt: Date | string, endedAt: Date | string, breakMinutes: number): number {
  return Math.max(0, Math.round((hoursBetween(startedAt, endedAt) - Math.max(0, breakMinutes) / 60) * 100) / 100);
}

export type Entry = { kind: string; started_at: string; ended_at: string | null };

/** Total closed 'work' hours across entries. Open entries and drive time are not counted. */
export function sumWorkHours(entries: Entry[]): number {
  const total = entries
    .filter((e) => e.kind === "work" && e.ended_at)
    .reduce((sum, e) => sum + hoursBetween(e.started_at, e.ended_at as string), 0);
  return Math.round(total * 100) / 100;
}

/** Splits a week's paid hours into regular and overtime (over 40). */
export function splitOvertime(weekHours: number): { regular: number; overtime: number } {
  const overtime = Math.max(0, Math.round((weekHours - OVERTIME_AFTER_HOURS) * 100) / 100);
  return { regular: Math.round((weekHours - overtime) * 100) / 100, overtime };
}
