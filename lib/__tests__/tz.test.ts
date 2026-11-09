import { describe, expect, it } from "vitest";
import {
  etDateAtHour,
  etLocalFromIso,
  formatEtShortDate,
  formatEtShortDateTime,
  moveToEtDate,
  toEtLocalInput,
} from "../tz";

// Results are compared as New York wall-clock strings, so the server's own
// timezone (UTC on Vercel) never matters.
const et = (d: Date | null) => (d ? toEtLocalInput(d) : null);

describe("moveToEtDate", () => {
  it("keeps an evening job on the day it was moved to", () => {
    // 8:00 PM ET on Nov 6 is 01:00 UTC on Nov 7.
    expect(et(moveToEtDate("2026-11-07T01:00:00.000Z", "2026-11-10"))).toBe("2026-11-10T20:00");
  });

  it("keeps a morning job's time", () => {
    expect(et(moveToEtDate("2026-11-06T14:30:00.000Z", "2026-11-12"))).toBe("2026-11-12T09:30");
  });

  it("keeps the New York time across the end of daylight saving time", () => {
    // 9:00 AM EDT on Oct 30, moved past Nov 1 to 9:00 AM EST.
    expect(et(moveToEtDate("2026-10-30T13:00:00.000Z", "2026-11-03"))).toBe("2026-11-03T09:00");
    expect(moveToEtDate("2026-10-30T13:00:00.000Z", "2026-11-03")?.toISOString()).toBe("2026-11-03T14:00:00.000Z");
  });

  it("lands at 9:00 AM New York when the job has no time yet", () => {
    expect(et(moveToEtDate(null, "2026-11-10"))).toBe("2026-11-10T09:00");
  });

  it("rejects a date that isn't YYYY-MM-DD", () => {
    expect(moveToEtDate(null, "2026-11-12T15:00:00.000Z")).toBeNull();
    expect(moveToEtDate(null, "")).toBeNull();
  });
});

describe("etLocalFromIso", () => {
  it("converts a time with a zone to New York", () => {
    expect(etLocalFromIso("2026-11-12T15:00:00.000Z")).toBe("2026-11-12T10:00");
    expect(etLocalFromIso("2026-07-15T10:00:00-04:00")).toBe("2026-07-15T10:00");
  });

  it("reads a time with no zone as New York time, not server time", () => {
    expect(etLocalFromIso("2026-11-12T10:00")).toBe("2026-11-12T10:00");
    expect(etLocalFromIso("2026-11-12 10:00:00")).toBe("2026-11-12T10:00");
  });

  it("returns null for something that isn't a date and time", () => {
    expect(etLocalFromIso("next tuesday")).toBeNull();
    expect(etLocalFromIso("2026-11-12")).toBeNull();
    expect(etLocalFromIso("")).toBeNull();
  });
});

describe("etDateAtHour", () => {
  it("puts a morning window at 8:00 AM New York, not 8:00 UTC", () => {
    expect(etDateAtHour("2026-11-10", 8)?.toISOString()).toBe("2026-11-10T13:00:00.000Z"); // EST
    expect(etDateAtHour("2026-07-15", 8)?.toISOString()).toBe("2026-07-15T12:00:00.000Z"); // EDT
  });

  it("keeps afternoon and evening windows on the chosen day", () => {
    expect(et(etDateAtHour("2026-11-10", 12))).toBe("2026-11-10T12:00");
    expect(et(etDateAtHour("2026-11-10", 16))).toBe("2026-11-10T16:00");
  });

  it("returns null for a bad date or hour", () => {
    expect(etDateAtHour("", 8)).toBeNull();
    expect(etDateAtHour("11/10/2026", 8)).toBeNull();
    expect(etDateAtHour("2026-11-10", 24)).toBeNull();
  });
});

describe("formatEtShortDate / formatEtShortDateTime", () => {
  it("shows New York time, not UTC", () => {
    // 1:20 AM in New York on Nov 9 is 06:20 UTC.
    expect(formatEtShortDateTime("2026-11-09T06:20:00Z")).toMatch(/^11\/9\/2026, 1:20\sAM$/);
    // 11 PM New York on Nov 8 is already Nov 9 in UTC; the date must stay Nov 8.
    expect(formatEtShortDate("2026-11-09T04:00:00Z")).toBe("11/8/2026");
    // Summer (EDT, UTC-4).
    expect(formatEtShortDateTime("2026-07-04T13:05:00Z")).toMatch(/^7\/4\/2026, 9:05\sAM$/);
  });

  it("shows a dash for a missing or bad date instead of 1970", () => {
    for (const value of [null, undefined, "", "not a date"]) {
      expect(formatEtShortDate(value)).toBe("—");
      expect(formatEtShortDateTime(value)).toBe("—");
    }
  });
});
