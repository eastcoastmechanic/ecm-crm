import { describe, expect, it } from "vitest";
import {
  autoCloseAt,
  hoursBetween,
  isStale,
  paidShiftHours,
  shiftNeedsBreak,
  splitOvertime,
  sumWorkHours,
} from "../time-clock-rules";

describe("time clock rules", () => {
  it("measures hours between two times, never negative", () => {
    expect(hoursBetween("2026-11-05T12:00:00Z", "2026-11-05T14:30:00Z")).toBe(2.5);
    expect(hoursBetween("2026-11-05T14:00:00Z", "2026-11-05T12:00:00Z")).toBe(0);
  });

  it("needs a meal break only after 6 hours", () => {
    expect(shiftNeedsBreak("2026-11-05T12:00:00Z", "2026-11-05T18:00:00Z")).toBe(false);
    expect(shiftNeedsBreak("2026-11-05T12:00:00Z", "2026-11-05T18:01:00Z")).toBe(true);
  });

  it("takes the unpaid break off a shift", () => {
    expect(paidShiftHours("2026-11-05T12:00:00Z", "2026-11-05T20:30:00Z", 30)).toBe(8);
    expect(paidShiftHours("2026-11-05T12:00:00Z", "2026-11-05T12:10:00Z", 60)).toBe(0);
  });

  it("flags rows open past the cap", () => {
    const now = new Date("2026-11-06T12:00:00Z");
    expect(isStale("2026-11-05T23:00:00Z", 14, now)).toBe(false);
    expect(isStale("2026-11-05T19:00:00Z", 14, now)).toBe(true);
    expect(autoCloseAt("2026-11-05T12:00:00Z", 12).toISOString()).toBe("2026-11-06T00:00:00.000Z");
  });

  it("sums only closed work entries", () => {
    expect(
      sumWorkHours([
        { kind: "work", started_at: "2026-11-05T13:00:00Z", ended_at: "2026-11-05T14:00:00Z" },
        { kind: "work", started_at: "2026-11-05T15:00:00Z", ended_at: "2026-11-05T15:30:00Z" },
        { kind: "drive", started_at: "2026-11-05T12:00:00Z", ended_at: "2026-11-05T13:00:00Z" },
        { kind: "work", started_at: "2026-11-05T16:00:00Z", ended_at: null },
      ])
    ).toBe(1.5);
  });

  it("splits a week at 40 hours", () => {
    expect(splitOvertime(38.5)).toEqual({ regular: 38.5, overtime: 0 });
    expect(splitOvertime(40)).toEqual({ regular: 40, overtime: 0 });
    expect(splitOvertime(46.25)).toEqual({ regular: 40, overtime: 6.25 });
  });
});
