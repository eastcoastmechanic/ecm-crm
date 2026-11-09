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
