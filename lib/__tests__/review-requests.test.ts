import { describe, expect, it } from "vitest";
import { nextReviewText, reviewTextCopy, reviewTriggerAt } from "../review-requests";

const day = 24 * 60 * 60 * 1000;
const now = new Date("2026-11-20T16:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * day).toISOString();

describe("reviewTriggerAt", () => {
  it("uses the earliest paid date when an invoice is paid", () => {
    expect(
      reviewTriggerAt({
        completedAt: ago(10),
        invoices: [
          { status: "paid", paid_at: ago(3) },
          { status: "paid", paid_at: ago(5) },
        ],
      })
    ).toBe(ago(5));
  });

  it("falls back to the finish time when paid but no paid date is on file", () => {
    expect(reviewTriggerAt({ completedAt: ago(4), invoices: [{ status: "paid", paid_at: null }] })).toBe(ago(4));
  });

  it("waits while an invoice is unpaid", () => {
    expect(reviewTriggerAt({ completedAt: ago(4), invoices: [{ status: "sent", paid_at: null }] })).toBeNull();
  });

  it("ignores void invoices", () => {
    expect(reviewTriggerAt({ completedAt: ago(4), invoices: [{ status: "void", paid_at: null }] })).toBe(ago(4));
  });

  it("uses the finish time when nothing was invoiced here", () => {
    expect(reviewTriggerAt({ completedAt: ago(4), invoices: [] })).toBe(ago(4));
  });

  it("has no trigger without a finish time or payment", () => {
    expect(reviewTriggerAt({ completedAt: null, invoices: [] })).toBeNull();
  });
});

describe("nextReviewText", () => {
  const base = { requestSentAt: null, reminderSentAt: null, answered: false, now };

  it("asks one day after the trigger", () => {
    expect(nextReviewText({ ...base, triggerAt: ago(1.1) })).toBe("request");
  });

  it("is too early before a day has passed", () => {
    expect(nextReviewText({ ...base, triggerAt: ago(0.5) })).toBeNull();
  });

  it("does not reach back into old work", () => {
    expect(nextReviewText({ ...base, triggerAt: ago(20) })).toBeNull();
  });

  it("does nothing without a trigger", () => {
    expect(nextReviewText({ ...base, triggerAt: null })).toBeNull();
  });

  it("sends one reminder five days after the ask", () => {
    expect(nextReviewText({ ...base, triggerAt: ago(7), requestSentAt: ago(5.1) })).toBe("reminder");
  });

  it("is too early for the reminder before five days", () => {
    expect(nextReviewText({ ...base, triggerAt: ago(7), requestSentAt: ago(4) })).toBeNull();
  });

  it("never sends a second reminder", () => {
    expect(nextReviewText({ ...base, triggerAt: ago(9), requestSentAt: ago(7), reminderSentAt: ago(1) })).toBeNull();
  });

  it("drops a reminder that is far too late", () => {
    expect(nextReviewText({ ...base, triggerAt: ago(30), requestSentAt: ago(20) })).toBeNull();
  });

  it("does not ask by text if the survey email already went out", () => {
    expect(nextReviewText({ ...base, triggerAt: ago(2), emailedAt: ago(1) })).toBeNull();
  });

  it("still sends the reminder when the ask itself was a text", () => {
    expect(
      nextReviewText({ ...base, triggerAt: ago(7), requestSentAt: ago(6), emailedAt: ago(8) })
    ).toBe("reminder");
  });

  it("stops once they answered, before or after the ask", () => {
    expect(nextReviewText({ ...base, triggerAt: ago(2), answered: true })).toBeNull();
    expect(nextReviewText({ ...base, triggerAt: ago(7), requestSentAt: ago(6), answered: true })).toBeNull();
  });
});

describe("reviewTextCopy", () => {
  const url = "https://x.test/survey/j1";

  it("uses the first name, the link and STOP wording", () => {
    const t = reviewTextCopy({ kind: "request", customerName: "Dana Smith", url });
    expect(t).toContain("Hi Dana,");
    expect(t).not.toContain("Smith");
    expect(t).toContain(url);
    expect(t).toMatch(/STOP/);
  });

  it("copes with no name", () => {
    expect(reviewTextCopy({ kind: "request", customerName: null, url })).toContain("Hi,");
  });

  it("the reminder reads as a reminder", () => {
    expect(reviewTextCopy({ kind: "reminder", customerName: "Dana", url })).toMatch(/reminder/i);
  });
});
