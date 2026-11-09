import { addDaysToDateKey, etDateKey, etDayRange } from "@/lib/tz";
import { hoursBetween, paidShiftHours } from "@/lib/time-clock-rules";

// Hours for the clock bar: today and the running week total for one person.
// Same rules as the payroll report (buildWeekReport in time-report.ts), so the clock,
// the Hours page and the Gusto file always agree:
// - The week is Monday 00:00 to the next Monday 00:00, New York time.
// - A shift belongs wholly to the New York day (and week) it started on, even past midnight.
// - Worked time = shift length minus the meal break, per shift (paidShiftHours).
// - Flagged and auto-closed shifts count as they stand; the office fixes them on /hours.
// One difference on purpose: the shift still open counts up to "now" (payroll skips it until clock out).
// Pure (no database), and safe to import in a client component.

export type ClockShift = { started_at: string; ended_at: string | null; break_minutes: number | null };

export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export type ClockDay = { dateKey: string; label: (typeof DAY_LABELS)[number]; hours: number };

export type ClockWeek = {
  /** Monday of the current New York week, YYYY-MM-DD. */
  weekStart: string;
  /** Today in New York, YYYY-MM-DD. */
  todayKey: string;
  /** Monday to Sunday. */
  days: ClockDay[];
  todayHours: number;
  weekHours: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Monday of the New York week containing the YYYY-MM-DD date (payroll week). */
export function mondayOfKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sun
  return addDaysToDateKey(dateKey, -((dow + 6) % 7));
}

/** UTC instants bounding the New York Monday-to-Sunday week containing `now` (start inclusive, end exclusive). */
export function etWeekRange(now: Date = new Date()): { weekStart: string; start: Date; end: Date } {
  const weekStart = mondayOfKey(etDateKey(now));
  return {
    weekStart,
    start: etDayRange(weekStart).start,
    end: etDayRange(addDaysToDateKey(weekStart, 7)).start,
  };
}

/** Paid hours for one shift; an open shift counts to `now` with no break yet. */
function shiftHours(shift: ClockShift, now: Date): number {
  if (shift.ended_at) return paidShiftHours(shift.started_at, shift.ended_at, shift.break_minutes ?? 0);
  return hoursBetween(shift.started_at, now);
}

/** Per-day, today and week hours for one person's shifts in the New York week containing `now`. */
export function clockWeek(shifts: ClockShift[], now: Date = new Date()): ClockWeek {
  const todayKey = etDateKey(now);
  const weekStart = mondayOfKey(todayKey);
  const days: ClockDay[] = DAY_LABELS.map((label, i) => ({ dateKey: addDaysToDateKey(weekStart, i), label, hours: 0 }));
  const byKey = new Map(days.map((d) => [d.dateKey, d]));

  let week = 0;
  for (const shift of shifts) {
    const day = byKey.get(etDateKey(new Date(shift.started_at)));
    if (!day) continue; // started in another week: payroll counts it there
    const hours = shiftHours(shift, now);
    day.hours += hours;
    week += hours;
  }
  for (const d of days) d.hours = r2(d.hours);
  return { weekStart, todayKey, days, todayHours: byKey.get(todayKey)?.hours ?? 0, weekHours: r2(week) };
}

/**
 * Adds the running shift to totals of finished shifts, so the client can tick live without a request.
 * `finished` is clockWeek() of the closed shifts only, computed on the server.
 */
export function withOpenShift(finished: ClockWeek, shiftStartedAt: string | null, now: Date = new Date()): ClockWeek {
  const todayKey = etDateKey(now);
  const days = finished.days.map((d) => ({ ...d }));
  let week = finished.weekHours;
  if (shiftStartedAt) {
    // Same rule as payroll: the running shift belongs to the day it started on.
    const day = days.find((d) => d.dateKey === etDateKey(new Date(shiftStartedAt)));
    if (day) {
      const open = hoursBetween(shiftStartedAt, now);
      day.hours = r2(day.hours + open);
      week = r2(week + open);
    }
  }
  return {
    weekStart: finished.weekStart,
    todayKey,
    days,
    todayHours: days.find((d) => d.dateKey === todayKey)?.hours ?? 0,
    weekHours: week,
  };
}

/** "16h 00m". */
export function formatHm(hours: number): string {
  const minutes = Math.max(0, Math.round(hours * 60));
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** "8:00", for the compact day row. */
export function formatHmShort(hours: number): string {
  const minutes = Math.max(0, Math.round(hours * 60));
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}
