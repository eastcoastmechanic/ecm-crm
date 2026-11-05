import { describe, expect, it } from "vitest";
import { buildWeekReport, weekCsv, type EntryRow, type ShiftRow } from "../time-report";

const staff = [
  { id: "a", name: "Sam", email: "sam@example.test" },
  { id: "b", name: 'Pat "P" Lee', email: "pat@example.test" },
  { id: "c", name: "Idle", email: null },
];

const shift = (id: string, staff_id: string, start: string, end: string | null, over: Partial<ShiftRow> = {}): ShiftRow => ({
  id, staff_id, started_at: start, ended_at: end, break_minutes: 0, flagged: false, reviewed_at: null, ...over,
});
const entry = (id: string, staff_id: string, kind: string, start: string, end: string | null, over: Partial<EntryRow> = {}): EntryRow => ({
  id, job_id: "j", staff_id, kind, started_at: start, ended_at: end, flagged: false, reviewed_at: null, ...over,
});

describe("buildWeekReport", () => {
  it("adds paid hours, job hours, drive hours and what is left over", () => {
    const rows = buildWeekReport(
      staff,
      [shift("s1", "a", "2026-11-02T12:00:00Z", "2026-11-02T20:30:00Z", { break_minutes: 30 })], // 8 paid
      [
        entry("e1", "a", "drive", "2026-11-02T12:30:00Z", "2026-11-02T13:00:00Z"), // 0.5
        entry("e2", "a", "work", "2026-11-02T13:00:00Z", "2026-11-02T17:00:00Z"), // 4
      ]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Sam", paidHours: 8, jobHours: 4, driveHours: 0.5, otherHours: 3.5, regular: 8, overtime: 0 });
  });

  it("splits overtime over 40 paid hours", () => {
    const shifts = ["02", "03", "04", "05", "06"].map((d, i) =>
      shift(`s${i}`, "a", `2026-11-${d}T11:00:00Z`, `2026-11-${d}T20:00:00Z`, { break_minutes: 0 }) // 9h each = 45
    );
    const [row] = buildWeekReport(staff, shifts, []);
    expect(row).toMatchObject({ paidHours: 45, regular: 40, overtime: 5 });
  });

  it("does not count an open shift, and says so", () => {
    const [row] = buildWeekReport(staff, [shift("s1", "a", "2026-11-02T12:00:00Z", null)], []);
    expect(row).toMatchObject({ paidHours: 0, openShift: true });
  });

  it("counts only unreviewed flags", () => {
    const [row] = buildWeekReport(
      staff,
      [
        shift("s1", "a", "2026-11-02T12:00:00Z", "2026-11-02T14:00:00Z", { flagged: true }),
        shift("s2", "a", "2026-11-03T12:00:00Z", "2026-11-03T14:00:00Z", { flagged: true, reviewed_at: "2026-11-04T12:00:00Z" }),
      ],
      [entry("e1", "a", "work", "2026-11-02T12:00:00Z", "2026-11-02T13:00:00Z", { flagged: true })]
    );
    expect(row.flagged).toBe(2);
  });

  it("leaves out people with no time that week", () => {
    expect(buildWeekReport(staff, [], [])).toEqual([]);
  });
});

describe("weekCsv", () => {
  it("writes a header and one safe line per person", () => {
    const rows = buildWeekReport(staff, [shift("s1", "b", "2026-11-02T12:00:00Z", "2026-11-02T20:00:00Z")], []);
    const csv = weekCsv("2026-11-02", rows);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toContain("Regular hours");
    expect(lines[1]).toBe('"Pat ""P"" Lee",pat@example.test,2026-11-02,8,0,0,0,0,8,0');
  });
});
