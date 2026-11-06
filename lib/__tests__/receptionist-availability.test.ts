import { describe, expect, it } from "vitest";
import { openHoursFor, weekdayOf } from "../receptionist/availability";

describe("weekdayOf", () => {
  it("reads the calendar weekday, whatever the server timezone", () => {
    expect(weekdayOf("2026-11-09")).toBe(1); // Monday
    expect(weekdayOf("2026-11-14")).toBe(6); // Saturday
    expect(weekdayOf("2026-11-15")).toBe(0); // Sunday
  });
});

describe("openHoursFor", () => {
  it("is fully open with no jobs", () => {
    const { openHours, busyCount } = openHoursFor([]);
    expect(openHours[0]).toBe("08:00");
    expect(openHours.at(-1)).toBe("16:00");
    expect(busyCount).toBe(0);
  });

  it("blocks a 9 AM New York job for 2 hours, not 1-2 PM", () => {
    // 9:00 AM EST on Nov 10 is 14:00 UTC.
    const { openHours } = openHoursFor(["2026-11-10T14:00:00.000Z"]);
    expect(openHours).not.toContain("09:00");
    expect(openHours).not.toContain("10:00");
    expect(openHours).toContain("08:00");
    expect(openHours).toContain("11:00");
    expect(openHours).toContain("14:00");
  });

  it("uses New York time in summer too", () => {
    // 1:00 PM EDT on Jul 15 is 17:00 UTC.
    const { openHours } = openHoursFor(["2026-07-15T17:00:00.000Z"]);
    expect(openHours).not.toContain("13:00");
    expect(openHours).not.toContain("14:00");
    expect(openHours).toContain("12:00");
    expect(openHours).toContain("15:00");
  });
});
