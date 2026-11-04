// Pure helpers for the customer booking reminder on maintenance plan visits.
import { COMPANY_NAME, COMPANY_PHONE, COMPANY_PHONE_DISPLAY } from "./brand";
import { monthName } from "./maintenance-visits";

/** Days after the first reminder before the one follow-up goes out. Josh did not pick a number; one week. */
export const FOLLOWUP_AFTER_DAYS = 7;

export type ReminderKind = "booking" | "followup";

/**
 * Which reminder a visit is owed, if any. One booking reminder, then at most one follow-up
 * a week later. The caller only passes visits that are still unscheduled.
 */
export function nextReminder(opts: {
  bookingSentAt: string | null;
  followupSentAt: string | null;
  now: Date;
}): ReminderKind | null {
  const { bookingSentAt, followupSentAt, now } = opts;
  if (!bookingSentAt) return "booking";
  if (followupSentAt) return null;
  const waitedMs = now.getTime() - new Date(bookingSentAt).getTime();
  return waitedMs >= FOLLOWUP_AFTER_DAYS * 24 * 60 * 60 * 1000 ? "followup" : null;
}

export function reminderCopy(opts: { kind: ReminderKind; customerName: string | null; label: string; month: number }) {
  const { kind, customerName, label, month } = opts;
  const what = `${label.toLowerCase()} for ${monthName(month)}`;
  const hi = customerName ? `Hi ${customerName},` : "Hi,";
  const ask = `Reply to this message or call ${COMPANY_PHONE_DISPLAY} and we'll find a day that works.`;
  const lead =
    kind === "booking"
      ? `It's time to book your ${what}, part of your maintenance plan.`
      : `Just a reminder that your ${what} is still waiting to be scheduled.`;
  return {
    subject: kind === "booking" ? `Time to book your ${label.toLowerCase()}` : `Reminder: book your ${label.toLowerCase()}`,
    email: `${hi}\n\n${lead} ${ask}\n\n${COMPANY_NAME}`,
    text: `${COMPANY_NAME}: ${lead} Reply here or call ${COMPANY_PHONE} to pick a day. Reply STOP to opt out.`,
  };
}
