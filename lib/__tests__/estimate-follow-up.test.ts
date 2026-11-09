import { describe, expect, it } from "vitest";
import {
  estimateFollowUp,
  estimateFollowUpEmailBlocked,
  etDaysBetween,
  isTieredEstimate,
} from "../estimate-follow-up";

// Sent at 4 PM New York on Nov 1 (EDT ends Nov 1 2026 at 2 AM, so this is EST: 21:00 UTC).
const SENT = "2026-11-01T21:00:00Z";
// Noon New York on Nov 1 + n days.
const day = (n: number) => new Date(Date.UTC(2026, 10, 1 + n, 17, 0, 0));
const iso = (n: number) => day(n).toISOString();

describe("etDaysBetween", () => {
  it("counts New York calendar days, not 24-hour blocks", () => {
    // 11 PM ET Nov 1 to 1 AM ET Nov 2 is one day apart.
    expect(etDaysBetween("2026-11-02T04:00:00Z", "2026-11-02T06:00:00Z")).toBe(1);
    expect(etDaysBetween(SENT, iso(3))).toBe(3);
  });
  it("is null for unreadable dates", () => {
    expect(etDaysBetween("nope", iso(3))).toBeNull();
  });
});

describe("estimateFollowUp", () => {
  it("never sends without sent_at", () => {
    expect(estimateFollowUp({ sentAt: null, lastReminderAt: null }, day(5))).toEqual({ send: false });
  });
  it("waits until day 3", () => {
    expect(estimateFollowUp({ sentAt: SENT, lastReminderAt: null }, day(2))).toEqual({ send: false });
  });
  it("sends the first follow-up on day 3 to 9", () => {
    expect(estimateFollowUp({ sentAt: SENT, lastReminderAt: null }, day(3))).toEqual({ send: true, number: 1, first: true });
    expect(estimateFollowUp({ sentAt: SENT, lastReminderAt: null }, day(9))).toEqual({ send: true, number: 1, first: true });
  });
  it("does not repeat the first one before day 10", () => {
    expect(estimateFollowUp({ sentAt: SENT, lastReminderAt: iso(3) }, day(4))).toEqual({ send: false });
    expect(estimateFollowUp({ sentAt: SENT, lastReminderAt: iso(3) }, day(9))).toEqual({ send: false });
  });
  it("sends the second on day 10 to 16", () => {
    expect(estimateFollowUp({ sentAt: SENT, lastReminderAt: iso(3) }, day(10))).toEqual({ send: true, number: 2, first: false });
    expect(estimateFollowUp({ sentAt: SENT, lastReminderAt: iso(3) }, day(16))).toEqual({ send: true, number: 2, first: false });
  });
  it("stops after the second", () => {
    for (const n of [11, 12, 16, 30]) {
      expect(estimateFollowUp({ sentAt: SENT, lastReminderAt: iso(10) }, day(n))).toEqual({ send: false });
    }
  });
  it("sends nothing after day 16, even if none went out", () => {
    expect(estimateFollowUp({ sentAt: SENT, lastReminderAt: null }, day(17))).toEqual({ send: false });
    expect(estimateFollowUp({ sentAt: SENT, lastReminderAt: null }, day(200))).toEqual({ send: false });
  });
  it("sends one, counted as the second, if the cron missed days 3 to 9", () => {
    expect(estimateFollowUp({ sentAt: SENT, lastReminderAt: null }, day(12))).toEqual({ send: true, number: 2, first: true });
    expect(estimateFollowUp({ sentAt: SENT, lastReminderAt: iso(12) }, day(13))).toEqual({ send: false });
  });
  it("ignores a follow-up from before the estimate was sent again", () => {
    expect(estimateFollowUp({ sentAt: SENT, lastReminderAt: "2026-10-01T15:00:00Z" }, day(3))).toEqual({
      send: true,
      number: 1,
      first: true,
    });
  });
});

describe("estimateFollowUpEmailBlocked", () => {
  it("blocks opted-out and no-follow-up customers", () => {
    expect(estimateFollowUpEmailBlocked({ email_opt_out_at: "2026-10-01T00:00:00Z" })).toBe(true);
    expect(estimateFollowUpEmailBlocked({ no_followups: true })).toBe(true);
  });
  it("allows everyone else", () => {
    expect(estimateFollowUpEmailBlocked({ email_opt_out_at: null, no_followups: false })).toBe(false);
    expect(estimateFollowUpEmailBlocked(null)).toBe(false);
  });
});

describe("isTieredEstimate", () => {
  it("follows a stored mode", () => {
    expect(isTieredEstimate({ pricing_mode: "flat", totals: { good: 1, better: 2, best: 3 } })).toBe(false);
    expect(isTieredEstimate({ pricing_mode: "tiered" })).toBe(true);
  });
  it("with no mode, is tiered only when options price differently", () => {
    expect(isTieredEstimate({ totals: { good: 100, better: 200, best: 300 } })).toBe(true);
    expect(isTieredEstimate({ totals: { good: 200, better: 200, best: 200 } })).toBe(false);
    expect(isTieredEstimate({ items: [{ good: null, better: 50, best: null }] })).toBe(false);
    expect(isTieredEstimate(null)).toBe(false);
  });
});
