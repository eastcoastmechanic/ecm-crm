import { describe, expect, it } from "vitest";
import {
  checkTimeRange,
  editNote,
  liveRows,
  missingTimeEditSchema,
  readBreakMinutes,
  readReason,
  timeEditRecord,
  timeSnapshot,
} from "../time-edit-rules";
import { sumWorkHours } from "../time-clock-rules";
import { buildWeekReport, weekCsv, type EntryRow, type ShiftRow } from "../time-report";

const now = new Date("2026-11-05T20:00:00Z"); // Thu 3:00 PM New York
const d = (iso: string) => new Date(iso);

describe("checkTimeRange", () => {
  const base = { table: "time_shifts" as const, now, others: [] };

  it("accepts a normal shift", () => {
    expect(checkTimeRange({ ...base, start: d("2026-11-04T12:00:00Z"), end: d("2026-11-04T20:30:00Z"), breakMinutes: 30 })).toBeNull();
  });

  it("needs the end after the start", () => {
    expect(checkTimeRange({ ...base, start: d("2026-11-04T12:00:00Z"), end: d("2026-11-04T12:00:00Z") })).toMatch(/after the start/);
    expect(checkTimeRange({ ...base, start: d("2026-11-04T12:00:00Z"), end: d("2026-11-04T11:00:00Z") })).toMatch(/after the start/);
  });

  it("refuses times in the future", () => {
    expect(checkTimeRange({ ...base, start: d("2026-11-05T21:00:00Z"), end: null })).toMatch(/start time is in the future/);
    expect(checkTimeRange({ ...base, start: d("2026-11-05T12:00:00Z"), end: d("2026-11-05T21:00:00Z") })).toMatch(/end time is in the future/);
  });

  it("caps a shift at 16 hours", () => {
    expect(checkTimeRange({ ...base, start: d("2026-11-04T08:00:00Z"), end: d("2026-11-05T00:00:00Z") })).toBeNull(); // exactly 16
    expect(checkTimeRange({ ...base, start: d("2026-11-04T08:00:00Z"), end: d("2026-11-05T00:01:00Z") })).toMatch(/over 16 hours/);
  });

  it("counts a row left running up to now against the cap", () => {
    expect(checkTimeRange({ ...base, start: d("2026-11-05T03:00:00Z"), end: null })).toMatch(/over 16 hours/);
    expect(checkTimeRange({ ...base, start: d("2026-11-05T12:00:00Z"), end: null })).toBeNull();
  });

  it("refuses a meal break as long as the shift", () => {
    expect(checkTimeRange({ ...base, start: d("2026-11-04T12:00:00Z"), end: d("2026-11-04T12:30:00Z"), breakMinutes: 30 })).toMatch(/meal break/);
  });

  it("refuses an overlap with the same person's other shift, but not touching ends", () => {
    const others = [{ id: "s2", started_at: "2026-11-04T12:00:00Z", ended_at: "2026-11-04T16:00:00Z" }];
    expect(checkTimeRange({ ...base, others, start: d("2026-11-04T15:00:00Z"), end: d("2026-11-04T18:00:00Z") })).toMatch(/overlaps another day shift/);
    expect(checkTimeRange({ ...base, others, start: d("2026-11-04T16:00:00Z"), end: d("2026-11-04T18:00:00Z") })).toBeNull();
  });

  it("treats another open row as running to now", () => {
    const others = [{ id: "s2", started_at: "2026-11-05T13:00:00Z", ended_at: null }];
    expect(checkTimeRange({ ...base, others, start: d("2026-11-05T12:00:00Z"), end: d("2026-11-05T14:00:00Z") })).toMatch(/overlaps/);
  });

  it("ignores the row being edited and voided rows", () => {
    const others = [
      { id: "self", started_at: "2026-11-04T12:00:00Z", ended_at: "2026-11-04T20:00:00Z" },
      { id: "gone", started_at: "2026-11-04T12:00:00Z", ended_at: "2026-11-04T20:00:00Z", voided_at: "2026-11-05T12:00:00Z" },
    ];
    expect(checkTimeRange({ ...base, others, selfId: "self", start: d("2026-11-04T13:00:00Z"), end: d("2026-11-04T19:00:00Z") })).toBeNull();
  });

  it("names job timers in the overlap message", () => {
    const others = [{ id: "e2", started_at: "2026-11-04T12:00:00Z", ended_at: "2026-11-04T16:00:00Z" }];
    expect(
      checkTimeRange({ table: "job_time_entries", now, others, start: d("2026-11-04T13:00:00Z"), end: d("2026-11-04T14:00:00Z") })
    ).toMatch(/another job timer/);
  });
});

describe("form readers", () => {
  it("needs a short reason", () => {
    expect(readReason("  ")).toEqual({ error: "Add a short reason for the change." });
    expect(readReason(" forgot to clock out ")).toEqual({ reason: "forgot to clock out" });
    expect(readReason("x".repeat(201))).toHaveProperty("error");
  });

  it("reads meal break minutes", () => {
    expect(readBreakMinutes("")).toBe(0);
    expect(readBreakMinutes("30")).toBe(30);
    expect(readBreakMinutes("-5")).toBeNull();
    expect(readBreakMinutes("2.5")).toBeNull();
    expect(readBreakMinutes("481")).toBeNull();
  });
});

describe("audit record", () => {
  it("keeps the time fields before and after, and who and why", () => {
    const before = {
      id: "s1",
      staff_id: "a",
      started_at: "2026-11-04T12:00:00Z",
      ended_at: "2026-11-05T02:00:00Z",
      break_minutes: 0,
      flagged: true,
      source: "app",
    };
    const rec = timeEditRecord({
      table: "time_shifts",
      rowId: "s1",
      action: "edit",
      before,
      change: { ended_at: "2026-11-04T20:30:00Z", break_minutes: 30, source: "office" },
      reason: "Forgot to clock out",
      editedBy: "owner-1",
    });
    expect(rec).toEqual({
      table_name: "time_shifts",
      row_id: "s1",
      action: "edit",
      before: { staff_id: "a", started_at: "2026-11-04T12:00:00Z", ended_at: "2026-11-05T02:00:00Z", break_minutes: 0, source: "app" },
      after: { staff_id: "a", started_at: "2026-11-04T12:00:00Z", ended_at: "2026-11-04T20:30:00Z", break_minutes: 30, source: "office" },
      reason: "Forgot to clock out",
      edited_by: "owner-1",
    });
  });

  it("has no before for an added row", () => {
    const rec = timeEditRecord({ table: "job_time_entries", rowId: "e1", action: "add", before: null, change: { kind: "work", job_id: "j" }, reason: "r", editedBy: null });
    expect(rec.before).toBeNull();
    expect(rec.after).toEqual({ kind: "work", job_id: "j" });
    expect(timeSnapshot(null)).toBeNull();
  });

  it("spots a database without SQL 0078", () => {
    expect(missingTimeEditSchema({ code: "PGRST204", message: "Could not find the 'voided_at' column" })).toBe(true);
    expect(missingTimeEditSchema({ code: "42703", message: "column does not exist" })).toBe(true);
    expect(missingTimeEditSchema({ code: "23505", message: "duplicate key" })).toBe(false);
    expect(missingTimeEditSchema(null)).toBe(false);
  });

  it("writes the note under an edited row", () => {
    expect(editNote({ action: "edit", reason: "Forgot to clock out" }, "Josh", "11/9/2026")).toBe(
      "Edited by Josh on 11/9/2026: Forgot to clock out"
    );
    expect(editNote({ action: "pause", reason: null }, "Josh", "11/9/2026")).toBe("Paused by Josh on 11/9/2026");
  });
});

describe("voided rows count for nothing", () => {
  const staff = [{ id: "a", name: "Sam", email: "sam@example.test" }];
  const shift = (id: string, start: string, end: string, voided_at: string | null = null): ShiftRow => ({
    id, staff_id: "a", started_at: start, ended_at: end, break_minutes: 0, flagged: false, reviewed_at: null, voided_at,
  });
  const entry = (id: string, kind: string, start: string, end: string, voided_at: string | null = null): EntryRow => ({
    id, job_id: "j", staff_id: "a", kind, started_at: start, ended_at: end, flagged: false, reviewed_at: null, voided_at,
  });

  it("leaves voided shifts and job timers out of the week and the hours file", () => {
    const shifts = [
      shift("s1", "2026-11-02T12:00:00Z", "2026-11-02T20:00:00Z"), // 8
      shift("s2", "2026-11-03T12:00:00Z", "2026-11-03T20:00:00Z", "2026-11-04T12:00:00Z"), // voided
    ];
    const entries = [
      entry("e1", "work", "2026-11-02T13:00:00Z", "2026-11-02T15:00:00Z"), // 2
      entry("e2", "work", "2026-11-03T13:00:00Z", "2026-11-03T18:00:00Z", "2026-11-04T12:00:00Z"), // voided
      entry("e3", "drive", "2026-11-02T12:30:00Z", "2026-11-02T13:00:00Z", "2026-11-04T12:00:00Z"), // voided
    ];
    const [row] = buildWeekReport(staff, shifts, entries);
    expect(row).toMatchObject({ paidHours: 8, jobHours: 2, driveHours: 0, otherHours: 6 });
    const csv = weekCsv("2026-11-02", [row]);
    expect(csv.split("\n")[1]).toBe("Sam,sam@example.test,2026-11-02,8,0,0,2,0,6,0");
  });

  it("does not count a voided row's flag", () => {
    const flagged = { ...shift("s1", "2026-11-02T12:00:00Z", "2026-11-02T20:00:00Z", "2026-11-04T12:00:00Z"), flagged: true };
    expect(buildWeekReport(staff, [flagged, shift("s2", "2026-11-03T12:00:00Z", "2026-11-03T14:00:00Z")], [])[0].flagged).toBe(0);
  });

  it("drops a person whose only time was voided", () => {
    expect(buildWeekReport(staff, [shift("s1", "2026-11-02T12:00:00Z", "2026-11-02T20:00:00Z", "x")], [])).toEqual([]);
  });

  it("job tracked hours skip voided work", () => {
    expect(
      sumWorkHours([
        { kind: "work", started_at: "2026-11-02T13:00:00Z", ended_at: "2026-11-02T15:00:00Z" },
        { kind: "work", started_at: "2026-11-02T16:00:00Z", ended_at: "2026-11-02T19:00:00Z", voided_at: "2026-11-04T12:00:00Z" },
      ])
    ).toBe(2);
    expect(liveRows([{ voided_at: null }, { voided_at: "x" }, {}])).toHaveLength(2);
  });
});
