import { describe, expect, it } from "vitest";
import { etLocalFromIso, moveToEtDate, toEtLocalInput } from "../tz";

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
