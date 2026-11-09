// Per-customer shutoff for automatic post-job client follow-ups.
// Scheduling texts, invoice reminders, and owner alerts do not use this.

/** True when this customer should not get the survey text or the follow-up email. */
export function skipsPostJobFollowUps(
  customer: { no_followups?: boolean | null } | null | undefined,
): boolean {
  return customer?.no_followups === true;
}

/**
 * The "how did we do" email. Skipped when the customer opted out, has no email,
 * or will get the review text instead.
 */
export function shouldSendJobFollowUpEmail(opts: {
  email: string | null | undefined;
  noFollowups: boolean | null | undefined;
  getsReviewText: boolean;
}): boolean {
  if (skipsPostJobFollowUps({ no_followups: opts.noFollowups })) return false;
  if (!opts.email) return false;
  if (opts.getsReviewText) return false;
  return true;
}

/** The "how did we do" email goes out from 1 day after the job is finished... */
export const SURVEY_EMAIL_FIRST_DAY = 1;
/** ...and is still sent up to 14 days after, so a missed cron run catches up the next day. */
export const SURVEY_EMAIL_LAST_DAY = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The finished-at range the cron asks the database for (ISO times). */
export function surveyEmailWindow(now: Date): { finishedBefore: string; finishedAfter: string } {
  return {
    finishedBefore: new Date(now.getTime() - SURVEY_EMAIL_FIRST_DAY * DAY_MS).toISOString(),
    finishedAfter: new Date(now.getTime() - SURVEY_EMAIL_LAST_DAY * DAY_MS).toISOString(),
  };
}

/**
 * Whether a finished job is due the survey email today, before the customer
 * rules (shouldSendJobFollowUpEmail) are checked. Due when it finished 1 to 14
 * days ago, the email has not gone out (follow_up_sent_at), and the review text
 * has not gone out either (review_request_sent_at): a texted customer gets the
 * text instead, even if they can no longer be texted by the time this runs.
 */
export function surveyEmailDue(
  job: {
    completed_at: string | null | undefined;
    follow_up_sent_at?: string | null;
    review_request_sent_at?: string | null;
  },
  now: Date,
): boolean {
  if (!job.completed_at || job.follow_up_sent_at || job.review_request_sent_at) return false;
  const finished = new Date(job.completed_at).getTime();
  if (Number.isNaN(finished)) return false;
  const { finishedBefore, finishedAfter } = surveyEmailWindow(now);
  return finished <= new Date(finishedBefore).getTime() && finished >= new Date(finishedAfter).getTime();
}
