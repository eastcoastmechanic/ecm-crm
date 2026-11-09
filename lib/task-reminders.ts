import { etDateKey, etDayRange, formatEtDateTime } from "@/lib/tz";

// The owner's daily task digest. "Due today" is the New York calendar day: the
// server runs in UTC, so setHours/toLocaleDateString would end "today" at 7 or
// 8 PM ET and print the wrong date for anything due late in the evening.

export type DigestTask = { title: string; dueDateTime: string | null; notes?: string | null };

/** Tasks due before the end of today in New York (overdue ones included). */
export function tasksDueByEndOfEtDay<T extends DigestTask>(tasks: T[], now: Date = new Date()): T[] {
  const { end } = etDayRange(etDateKey(now));
  return tasks.filter((t) => t.dueDateTime && new Date(t.dueDateTime).getTime() < end.getTime());
}

/** One digest line. Overdue means due on an earlier New York day, not earlier today. */
export function taskDigestLine(task: DigestTask, now: Date = new Date()): string {
  const due = new Date(task.dueDateTime as string);
  const overdue = etDateKey(due) < etDateKey(now);
  const dueText = formatEtDateTime(due, { month: "numeric", day: "numeric", year: "numeric" });
  return `- ${task.title}${overdue ? " (overdue)" : ""} — due ${dueText}${task.notes ? `: ${task.notes}` : ""}`;
}
