import { describe, expect, it } from "vitest";
import { dueDayKey, formatDue } from "@/app/(internal)/tasks/due-date";

// The Tasks page shows Planner due dates as New York calendar days. A
// date-only or midnight-UTC due date must not show a day early.

describe("dueDayKey", () => {
  it("a plain date is that date", () => {
    expect(dueDayKey("2026-11-10")).toBe("2026-11-10");
  });

  it("midnight UTC (a date-only due date) is that date, not the evening before in New York", () => {
    expect(dueDayKey("2026-11-10T00:00:00Z")).toBe("2026-11-10");
    expect(dueDayKey("2026-11-10T00:00:00.0000000Z")).toBe("2026-11-10");
    expect(dueDayKey("2026-11-10T00:00:00+00:00")).toBe("2026-11-10");
  });

  it("noon New York (how the CRM creates tasks) is that day", () => {
    expect(dueDayKey("2026-11-10T17:00:00.000Z")).toBe("2026-11-10");
  });

  it("an evening time in New York stays on the New York day", () => {
    // 9 PM ET Nov 10 is 02:00 UTC Nov 11.
    expect(dueDayKey("2026-11-11T02:00:00Z")).toBe("2026-11-10");
  });

  it("junk is null", () => {
    expect(dueDayKey("soon")).toBeNull();
  });
});

describe("formatDue", () => {
  const now = new Date("2026-11-10T15:00:00Z"); // 10 AM ET Nov 10

  it("no due date shows nothing", () => {
    expect(formatDue(null, now)).toBeNull();
  });

  it("prints M/D/YYYY", () => {
    expect(formatDue("2026-11-12T17:00:00Z", now)).toEqual({ label: "11/12/2026", isOverdue: false });
  });

  it("due today is not overdue yet, even once the due time has passed", () => {
    expect(formatDue("2026-11-10T00:00:00Z", now)).toEqual({ label: "11/10/2026", isOverdue: false });
    expect(formatDue("2026-11-10T13:00:00Z", now)?.isOverdue).toBe(false);
  });

  it("due on an earlier New York day is overdue", () => {
    expect(formatDue("2026-11-09T17:00:00Z", now)).toEqual({ label: "11/9/2026", isOverdue: true });
  });
});
