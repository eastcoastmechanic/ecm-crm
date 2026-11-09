import { describe, expect, it } from "vitest";
import {
  shouldSendJobFollowUpEmail,
  skipsPostJobFollowUps,
  surveyEmailDue,
  surveyEmailWindow,
} from "../post-job-followups";

describe("skipsPostJobFollowUps", () => {
  it("skips only when the customer flag is on", () => {
    expect(skipsPostJobFollowUps({ no_followups: true })).toBe(true);
    expect(skipsPostJobFollowUps({ no_followups: false })).toBe(false);
    expect(skipsPostJobFollowUps({ no_followups: null })).toBe(false);
    expect(skipsPostJobFollowUps(null)).toBe(false);
    expect(skipsPostJobFollowUps(undefined)).toBe(false);
  });
});

describe("shouldSendJobFollowUpEmail", () => {
  it("sends when there is an email and they are not getting the text", () => {
    expect(
      shouldSendJobFollowUpEmail({ email: "a@b.com", noFollowups: false, getsReviewText: false }),
    ).toBe(true);
  });

  it("does not email a customer who opted out of follow-ups", () => {
    expect(
      shouldSendJobFollowUpEmail({ email: "a@b.com", noFollowups: true, getsReviewText: false }),
    ).toBe(false);
  });

  it("does not email when the review text will go out instead", () => {
    expect(
      shouldSendJobFollowUpEmail({ email: "a@b.com", noFollowups: false, getsReviewText: true }),
    ).toBe(false);
  });

  it("does not email without an address", () => {
    expect(shouldSendJobFollowUpEmail({ email: null, noFollowups: false, getsReviewText: false })).toBe(false);
    expect(shouldSendJobFollowUpEmail({ email: "", noFollowups: null, getsReviewText: false })).toBe(false);
  });
});

describe("surveyEmailDue", () => {
  const now = new Date("2026-11-09T15:00:00Z");
  const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000).toISOString();
  const job = (over: Record<string, unknown> = {}) => ({
    completed_at: daysAgo(1.5),
    follow_up_sent_at: null,
    review_request_sent_at: null,
    ...over,
  });

  it("sends a day after the job is finished, not sooner", () => {
    expect(surveyEmailDue(job({ completed_at: daysAgo(1) }), now)).toBe(true);
    expect(surveyEmailDue(job({ completed_at: daysAgo(0.5) }), now)).toBe(false);
  });

  it("catches up a job the cron missed for several days", () => {
    expect(surveyEmailDue(job({ completed_at: daysAgo(3) }), now)).toBe(true);
    expect(surveyEmailDue(job({ completed_at: daysAgo(10) }), now)).toBe(true);
    expect(surveyEmailDue(job({ completed_at: daysAgo(14) }), now)).toBe(true);
  });

  it("gives up after 14 days", () => {
    expect(surveyEmailDue(job({ completed_at: daysAgo(14.1) }), now)).toBe(false);
    expect(surveyEmailDue(job({ completed_at: daysAgo(30) }), now)).toBe(false);
  });

  it("never sends twice", () => {
    expect(surveyEmailDue(job({ follow_up_sent_at: daysAgo(1) }), now)).toBe(false);
  });

  it("skips a job whose customer already got the review text", () => {
    expect(surveyEmailDue(job({ review_request_sent_at: daysAgo(0.5) }), now)).toBe(false);
  });

  it("skips a job with no finish time", () => {
    expect(surveyEmailDue(job({ completed_at: null }), now)).toBe(false);
    expect(surveyEmailDue(job({ completed_at: "not a date" }), now)).toBe(false);
  });

  it("asks the database for the same 1 to 14 day range", () => {
    expect(surveyEmailWindow(now)).toEqual({ finishedBefore: daysAgo(1), finishedAfter: daysAgo(14) });
  });
});
