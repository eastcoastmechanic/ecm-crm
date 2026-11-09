import { etDateKey } from "@/lib/tz";

// Due dates on the Tasks page. Local helper (lib/tz.ts is being edited in
// another PR): the page renders on the server (UTC) and again in the browser,
// so the date has to come out the same in both, in New York time.
//
// Tasks this CRM creates are due at noon New York time. A due date set with no
// time (a plain "2026-11-10", or midnight UTC, which is how a date-only due
// date comes back) is a calendar date: shown as that date, never a day early.

const PLAIN_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00(?::00(?:\.0+)?)?(?:Z|\+00:00)?)?$/;

/** The New York calendar day ("YYYY-MM-DD") a task is due. Null if unreadable. */
export function dueDayKey(dueAt: string): string | null {
  const plain = PLAIN_DATE.exec(dueAt.trim());
  if (plain) return `${plain[1]}-${plain[2]}-${plain[3]}`;
  const when = new Date(dueAt);
  return Number.isNaN(when.getTime()) ? null : etDateKey(when);
}

/** "Due 11/10/2026", overdue only once the due day has passed in New York (same rule as the task digest). */
export function formatDue(dueAt: string | null, now: Date = new Date()): { label: string; isOverdue: boolean } | null {
  if (!dueAt) return null;
  const key = dueDayKey(dueAt);
  if (!key) return null;
  const [y, m, d] = key.split("-").map(Number);
  return { label: `${m}/${d}/${y}`, isOverdue: key < etDateKey(now) };
}
