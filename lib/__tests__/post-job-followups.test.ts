import { describe, expect, it } from "vitest";
import { shouldSendJobFollowUpEmail, skipsPostJobFollowUps } from "../post-job-followups";

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
