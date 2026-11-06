// Lead follow-up dates are plain calendar dates (YYYY-MM-DD). "Today" is the
// New York calendar day, passed in so this stays testable.

const CLOSED_STAGES = ["won", "lost", "dismissed"];

export type FollowUpState = "none" | "overdue" | "today" | "upcoming";

export function followUpState(followUpOn: string | null | undefined, stage: string, todayKey: string): FollowUpState {
  if (!followUpOn || CLOSED_STAGES.includes(stage)) return "none";
  if (followUpOn < todayKey) return "overdue";
  if (followUpOn === todayKey) return "today";
  return "upcoming";
}

/** "Nov 10" for a YYYY-MM-DD date, without any timezone shift. */
export function shortDate(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
