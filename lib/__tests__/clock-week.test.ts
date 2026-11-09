import { describe, expect, it } from "vitest";
import { clockWeek, etWeekRange, formatHm, formatHmShort, mondayOfKey, withOpenShift, type ClockShift } from "../clock-week";
import { buildWeekReport, type ShiftRow } from "../time-report";

// November 2026 is Eastern Standard Time (UTC-5): 8:00 AM ET = 13:00Z. Mon 2026-11-02.
const s = (start: string, end: string | null, break_minutes = 0): ClockShift => ({ started_at: start, ended_at: end, break_minutes });

describe("clockWeek", () => {
  it("Mon 8h + Tue 8h shows 16h on Wednesday before clocking in", () => {
    const shifts = [s("2026-11-02T13:00:00Z", "2026-11-02T21:00:00Z"), s("2026-11-03T13:00:00Z", "2026-11-03T21:00:00Z")];
    const week = clockWeek(shifts, new Date("2026-11-04T12:00:00Z")); // Wed 7:00 AM ET
    expect(week.weekStart).toBe("2026-11-02");
    expect(week.todayKey).toBe("2026-11-04");
    expect(week.weekHours).toBe(16);
    expect(week.todayHours).toBe(0);
    expect(week.days.map((d) => [d.label, d.hours])).toEqual([
      ["Mon", 8], ["Tue", 8], ["Wed", 0], ["Thu", 0], ["Fri", 0], ["Sat", 0], ["Sun", 0],
    ]);
    expect(formatHm(week.weekHours)).toBe("16h 00m");
  });

  it("subtracts the meal break", () => {
    const week = clockWeek([s("2026-11-02T13:00:00Z", "2026-11-02T21:30:00Z", 30)], new Date("2026-11-02T22:00:00Z"));
    expect(week.todayHours).toBe(8);
    expect(week.weekHours).toBe(8);
  });

  it("counts the open shift up to now", () => {
    const shifts = [s("2026-11-02T13:00:00Z", "2026-11-02T21:00:00Z"), s("2026-11-03T13:00:00Z", null)];
    const week = clockWeek(shifts, new Date("2026-11-03T15:30:00Z")); // 2.5h into Tuesday
    expect(week.todayHours).toBe(2.5);
    expect(week.weekHours).toBe(10.5);
  });

  it("adds finished shifts and a second shift on the same day", () => {
    const shifts = [s("2026-11-02T13:00:00Z", "2026-11-02T16:00:00Z"), s("2026-11-02T18:00:00Z", "2026-11-02T20:15:00Z")];
    const week = clockWeek(shifts, new Date("2026-11-02T21:00:00Z"));
    expect(week.todayHours).toBe(5.25);
    expect(formatHm(week.todayHours)).toBe("5h 15m");
  });

  it("starts a new week Monday 00:00 ET; a Sunday night shift stays in the old week", () => {
    // Sun 2026-11-08 10:00 PM ET to Mon 2026-11-09 2:00 AM ET.
    const sundayNight = s("2026-11-09T03:00:00Z", "2026-11-09T07:00:00Z");
    const oldWeek = clockWeek([sundayNight], new Date("2026-11-09T04:59:00Z")); // Sun 11:59 PM ET
    expect(oldWeek.weekStart).toBe("2026-11-02");
    const monday = clockWeek([sundayNight], new Date("2026-11-09T05:00:00Z")); // Mon 00:00 ET
    expect(monday.weekStart).toBe("2026-11-09");
    expect(monday.weekHours).toBe(0);
    // In the old week the whole shift sits on Sunday, as payroll counts it.
    const later = clockWeek([sundayNight], new Date("2026-11-09T04:00:00Z"));
    expect(later.days[6]).toMatchObject({ label: "Sun", hours: 4 });
  });

  it("handles the fall DST week (Sun 2026-11-01 is 25 hours)", () => {
    expect(etWeekRange(new Date("2026-10-28T16:00:00Z"))).toMatchObject({ weekStart: "2026-10-26" });
    const { start, end } = etWeekRange(new Date("2026-10-28T16:00:00Z"));
    expect(start.toISOString()).toBe("2026-10-26T04:00:00.000Z"); // EDT midnight
    expect(end.toISOString()).toBe("2026-11-02T05:00:00.000Z"); // EST midnight
    // Sunday 11:30 PM EST is still the old week; it is 2026-11-02T04:30Z.
    const week = clockWeek([s("2026-11-02T04:30:00Z", "2026-11-02T04:45:00Z")], new Date("2026-11-02T04:50:00Z"));
    expect(week.weekStart).toBe("2026-10-26");
    expect(week.days[6].hours).toBe(0.25);
  });

  it("handles the spring DST week (Sun 2026-03-08 is 23 hours)", () => {
    const { start, end } = etWeekRange(new Date("2026-03-04T17:00:00Z"));
    expect(start.toISOString()).toBe("2026-03-02T05:00:00.000Z"); // EST midnight
    expect(end.toISOString()).toBe("2026-03-09T04:00:00.000Z"); // EDT midnight
    expect(mondayOfKey("2026-03-08")).toBe("2026-03-02");
  });

  it("matches the payroll report's regular + overtime for the same shifts", () => {
    const rows: ShiftRow[] = [
      ["2026-11-02T12:00:00Z", "2026-11-02T22:07:00Z", 30],
      ["2026-11-03T12:13:00Z", "2026-11-03T23:00:00Z", 45],
      ["2026-11-04T11:00:00Z", "2026-11-05T01:00:00Z", 0], // auto-closed, flagged: counts as it stands
      ["2026-11-05T12:00:00Z", "2026-11-05T21:19:00Z", 20],
      ["2026-11-07T14:02:00Z", "2026-11-07T18:41:00Z", 0],
    ].map(([start, end, br], i) => ({
      id: `s${i}`, staff_id: "a", started_at: start as string, ended_at: end as string, break_minutes: br as number,
      flagged: i === 2, reviewed_at: null,
    }));
    const [payroll] = buildWeekReport([{ id: "a", name: "Sam", email: null }], rows, []);
    const week = clockWeek(rows, new Date("2026-11-08T20:00:00Z"));
    expect(payroll.overtime).toBeGreaterThan(0);
    expect(week.weekHours).toBe(Math.round((payroll.regular + payroll.overtime) * 100) / 100);
    expect(week.weekHours).toBe(payroll.paidHours);
  });
});

describe("withOpenShift", () => {
  it("adds the running shift to the finished totals and ticks with now", () => {
    const finished = clockWeek([s("2026-11-02T13:00:00Z", "2026-11-02T21:00:00Z")], new Date("2026-11-03T13:00:00Z"));
    const at = (iso: string) => withOpenShift(finished, "2026-11-03T13:00:00Z", new Date(iso));
    expect(at("2026-11-03T14:00:00Z")).toMatchObject({ todayHours: 1, weekHours: 9 });
    expect(at("2026-11-03T16:30:00Z")).toMatchObject({ todayHours: 3.5, weekHours: 11.5 });
    // Same answer as computing from all shifts at once.
    const all = clockWeek(
      [s("2026-11-02T13:00:00Z", "2026-11-02T21:00:00Z"), s("2026-11-03T13:00:00Z", null)],
      new Date("2026-11-03T16:30:00Z")
    );
    expect(at("2026-11-03T16:30:00Z")).toEqual(all);
  });

  it("resets at Monday 00:00 ET when the page stays open across it", () => {
    // Finished totals from Sunday 2026-11-08 (old week), Sunday night shift still running.
    const finished = clockWeek([s("2026-11-08T13:00:00Z", "2026-11-08T21:00:00Z")], new Date("2026-11-09T03:30:00Z"));
    expect(finished.weekHours).toBe(8);
    const monday = withOpenShift(finished, "2026-11-09T03:00:00Z", new Date("2026-11-09T06:00:00Z")); // Mon 1 AM ET
    expect(monday).toMatchObject({ weekStart: "2026-11-09", todayKey: "2026-11-09", todayHours: 0, weekHours: 0 });
    expect(withOpenShift(finished, null, new Date("2026-11-09T06:00:00Z")).weekHours).toBe(0);
  });

  it("leaves totals alone when not clocked in", () => {
    const finished = clockWeek([s("2026-11-02T13:00:00Z", "2026-11-02T21:00:00Z")], new Date("2026-11-04T12:00:00Z"));
    expect(withOpenShift(finished, null, new Date("2026-11-04T12:00:00Z"))).toEqual(finished);
  });

  it("puts an overnight running shift on the day it started", () => {
    const finished = clockWeek([], new Date("2026-11-04T03:00:00Z"));
    const live = withOpenShift(finished, "2026-11-04T01:00:00Z", new Date("2026-11-04T06:00:00Z")); // Tue 8 PM to Wed 1 AM ET
    expect(live.days[1]).toMatchObject({ label: "Tue", hours: 5 });
    expect(live.todayHours).toBe(0);
    expect(live.weekHours).toBe(5);
  });
});

describe("format", () => {
  it("prints hours and minutes", () => {
    expect(formatHm(0)).toBe("0h 00m");
    expect(formatHm(7.75)).toBe("7h 45m");
    expect(formatHmShort(8)).toBe("8:00");
    expect(formatHmShort(8.5)).toBe("8:30");
  });
});

describe("countableShifts", () => {
  it("leaves out voided shifts and keeps the rest", async () => {
    const { countableShifts } = await import("../clock-week");
    const rows = [
      { started_at: "2026-11-09T12:00:00Z", ended_at: "2026-11-09T20:00:00Z", break_minutes: 30, voided_at: null },
      { started_at: "2026-11-10T12:00:00Z", ended_at: "2026-11-10T20:00:00Z", break_minutes: 0, voided_at: "2026-11-11T12:00:00Z" },
      { started_at: "2026-11-11T12:00:00Z", ended_at: "2026-11-11T16:00:00Z", break_minutes: null },
    ];
    const out = countableShifts(rows);
    expect(out).toHaveLength(2);
    expect(out.map((s) => s.started_at)).toEqual(["2026-11-09T12:00:00Z", "2026-11-11T12:00:00Z"]);
    expect(out[1].break_minutes).toBeNull();
  });
});
