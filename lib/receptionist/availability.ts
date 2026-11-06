import { BUSINESS_HOURS, DEFAULT_JOB_DURATION_HOURS } from "./config";
import { etHour } from "@/lib/tz";

/** Weekday (0 = Sunday) of a calendar date "YYYY-MM-DD". No timezone involved. */
export function weekdayOf(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Open start times ("08:00") on a New York day, given the jobs already on it.
 * Each job blocks DEFAULT_JOB_DURATION_HOURS from its New York start hour.
 */
export function openHoursFor(scheduledAts: string[]): { openHours: string[]; busyCount: number } {
  const busyHours = new Set<number>();
  for (const at of scheduledAts) {
    const startHour = etHour(new Date(at));
    for (let h = startHour; h < startHour + DEFAULT_JOB_DURATION_HOURS; h++) busyHours.add(h);
  }
  const openHours: string[] = [];
  for (let h = BUSINESS_HOURS.startHour; h < BUSINESS_HOURS.endHour; h++) {
    if (!busyHours.has(h)) openHours.push(`${String(h).padStart(2, "0")}:00`);
  }
  return { openHours, busyCount: busyHours.size };
}
