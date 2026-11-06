// Pure rules for the text review request after a job. No database here so they are easy to test.
import { COMPANY_NAME } from "./brand";

/** Days after the invoice is paid (or the job is finished, if nothing was invoiced here) before the ask. */
export const REQUEST_AFTER_DAYS = 1;
/** Days after the ask before the one reminder. */
export const REMINDER_AFTER_DAYS = 5;
/** Never text about work older than this, so switching the feature on does not reach back into old jobs. */
export const LOOKBACK_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

export type InvoiceRow = { status: string | null; paid_at: string | null };

/**
 * When the clock for the review ask starts.
 *  - A paid invoice on the job: the earliest paid date (no paid date on file: the finish time).
 *  - Invoiced here but not paid yet: null, wait for payment.
 *  - No live invoice here (paid some other way, for example Square): the finish time.
 * Void invoices do not count.
 */
export function reviewTriggerAt(opts: { completedAt: string | null; invoices: InvoiceRow[] }): string | null {
  const live = opts.invoices.filter((i) => i.status !== "void");
  const paid = live.filter((i) => i.status === "paid");
  if (paid.length > 0) {
    const dates = paid.map((i) => i.paid_at).filter((d): d is string => !!d);
    if (dates.length === 0) return opts.completedAt;
    return dates.reduce((a, b) => (new Date(a) <= new Date(b) ? a : b));
  }
  if (live.length > 0) return null;
  return opts.completedAt;
}

export type ReviewTextKind = "request" | "reminder";

/** Which text a job is owed right now, if any. One ask, then at most one reminder, and nothing once they answered. */
export function nextReviewText(opts: {
  triggerAt: string | null;
  requestSentAt: string | null;
  reminderSentAt: string | null;
  answered: boolean;
  now: Date;
}): ReviewTextKind | null {
  const { triggerAt, requestSentAt, reminderSentAt, answered, now } = opts;
  if (answered) return null;

  if (!requestSentAt) {
    if (!triggerAt) return null;
    const age = now.getTime() - new Date(triggerAt).getTime();
    return age >= REQUEST_AFTER_DAYS * DAY_MS && age <= LOOKBACK_DAYS * DAY_MS ? "request" : null;
  }

  if (reminderSentAt) return null;
  const since = now.getTime() - new Date(requestSentAt).getTime();
  return since >= REMINDER_AFTER_DAYS * DAY_MS && since <= LOOKBACK_DAYS * DAY_MS ? "reminder" : null;
}

export function reviewTextCopy(opts: { kind: ReviewTextKind; customerName: string | null; url: string }): string {
  const first = (opts.customerName ?? "").trim().split(/\s+/)[0];
  const hi = first ? `Hi ${first},` : "Hi,";
  const lead =
    opts.kind === "request"
      ? `thanks for choosing us. How did we do? It takes 30 seconds:`
      : `quick reminder, we'd still love to hear how we did. 30 seconds:`;
  return `${COMPANY_NAME}: ${hi} ${lead} ${opts.url} Reply STOP to opt out.`;
}
