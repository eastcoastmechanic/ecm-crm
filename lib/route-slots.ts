import { etDateAtHour, toEtLocalInput } from "@/lib/tz";

// Slot spacing between stops on the optimized route: a fixed estimate, since
// real per-job duration isn't known ahead of time.
export const SLOT_HOURS = 1.5;
export const DAY_START_HOUR = 8;

/**
 * New York datetime-local values ("2026-11-10T09:30") for each stop on a
 * route day: 8:00 AM, then every 1.5 hours. Empty if the date is unreadable.
 */
export function routeSlotTimes(dateKey: string, count: number): string[] {
  const start = etDateAtHour(dateKey, DAY_START_HOUR);
  if (!start) return [];
  return Array.from({ length: count }, (_, i) =>
    toEtLocalInput(new Date(start.getTime() + i * SLOT_HOURS * 3600000))
  );
}
