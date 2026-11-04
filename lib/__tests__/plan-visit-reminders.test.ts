import { describe, expect, it } from "vitest";
import { nextReminder, reminderCopy } from "../plan-visit-reminders";

const now = new Date("2026-11-10T15:00:00Z");

describe("nextReminder", () => {
  it("sends the booking reminder first", () => {
    expect(nextReminder({ bookingSentAt: null, followupSentAt: null, now })).toBe("booking");
  });
  it("waits a week before the follow-up", () => {
    expect(nextReminder({ bookingSentAt: "2026-11-05T15:00:00Z", followupSentAt: null, now })).toBeNull();
    expect(nextReminder({ bookingSentAt: "2026-11-03T14:59:00Z", followupSentAt: null, now })).toBe("followup");
  });
  it("sends only one follow-up", () => {
    expect(nextReminder({ bookingSentAt: "2026-10-01T15:00:00Z", followupSentAt: "2026-10-08T15:00:00Z", now })).toBeNull();
  });
});

describe("reminderCopy", () => {
  it("names the visit and the month, and gives a way to book", () => {
    const c = reminderCopy({ kind: "booking", customerName: "Sam", label: "Heating tune-up", month: 10 });
    expect(c.email).toContain("heating tune-up for October");
    expect(c.text).toContain("Reply STOP to opt out");
    expect(c.text).toContain("774-343-6369");
  });
  it("marks the follow-up as a reminder", () => {
    const c = reminderCopy({ kind: "followup", customerName: null, label: "AC tune-up", month: 4 });
    expect(c.subject.startsWith("Reminder")).toBe(true);
  });
});
