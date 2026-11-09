// Which sent estimates get a follow-up email today. Pure, no I/O.
//
// At most two follow-ups per sending, with no new column:
//   - first:  3 to 9 New York days after sent_at, if none was sent yet
//   - second: 10 to 16 days after sent_at, if the only one so far went out
//             before day 10 (or none did)
// After day 16 nothing goes out. documents.last_reminder_sent_at records the
// last follow-up; one older than sent_at belongs to an earlier sending (the
// estimate was sent again) and does not count.

import { etDateKey } from "@/lib/tz";

export const FIRST_FOLLOW_UP_DAY = 3;
export const SECOND_FOLLOW_UP_DAY = 10;
export const LAST_FOLLOW_UP_DAY = 16;

export type EstimateFollowUpInput = {
  sentAt: string | null;
  lastReminderAt: string | null;
};

/** `first` is true when no follow-up went out yet for this sending (the staff Planner card goes with it). */
export type EstimateFollowUpDecision = { send: false } | { send: true; number: 1 | 2; first: boolean };

function dayIndex(iso: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const [y, m, day] = etDateKey(d).split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, day) / 86_400_000);
}

/** Whole New York calendar days from `from` to `to`. Null if either is unreadable. */
export function etDaysBetween(from: string, to: string): number | null {
  const a = dayIndex(from);
  const b = dayIndex(to);
  return a === null || b === null ? null : b - a;
}

export function estimateFollowUp(input: EstimateFollowUpInput, now: Date = new Date()): EstimateFollowUpDecision {
  if (!input.sentAt) return { send: false };
  const age = etDaysBetween(input.sentAt, now.toISOString());
  if (age === null || age < FIRST_FOLLOW_UP_DAY || age > LAST_FOLLOW_UP_DAY) return { send: false };

  const sentMs = new Date(input.sentAt).getTime();
  const lastMs = input.lastReminderAt ? new Date(input.lastReminderAt).getTime() : NaN;
  const reminded = Number.isFinite(lastMs) && lastMs >= sentMs;

  if (!reminded) return { send: true, number: age >= SECOND_FOLLOW_UP_DAY ? 2 : 1, first: true };

  const remindedOnDay = etDaysBetween(input.sentAt, input.lastReminderAt as string);
  if (remindedOnDay === null || remindedOnDay >= SECOND_FOLLOW_UP_DAY) return { send: false }; // second already went
  if (age >= SECOND_FOLLOW_UP_DAY) return { send: true, number: 2, first: false };
  return { send: false }; // first went, second not due yet
}

/** Opted out of offer emails or of follow-ups (SQL 0067 / 0069), so no customer email. */
export function estimateFollowUpEmailBlocked(
  customer: { email_opt_out_at?: string | null; no_followups?: boolean | null } | null | undefined
): boolean {
  return Boolean(customer?.email_opt_out_at) || customer?.no_followups === true;
}

type TierPrices = { good?: number | null; better?: number | null; best?: number | null };

/**
 * Good/Better/Best estimate still waiting on a pick: don't quote one total.
 * A stored mode decides. With no mode stored, it is tiered when the options
 * price differently (same rule as lib/estimate-routing.ts).
 */
export function isTieredEstimate(
  lineItems: { pricing_mode?: string | null; totals?: TierPrices | null; items?: TierPrices[] | null } | null | undefined
): boolean {
  if (!lineItems) return false;
  if (lineItems.pricing_mode) return lineItems.pricing_mode !== "flat";
  const differs = (p: TierPrices | null | undefined) =>
    !!p && ((p.good != null && p.good !== (p.better ?? null)) || (p.best != null && p.best !== (p.better ?? null)));
  return differs(lineItems.totals) || (lineItems.items ?? []).some(differs);
}
