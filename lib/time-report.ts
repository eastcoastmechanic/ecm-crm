import { hoursBetween, paidShiftHours, splitOvertime, sumWorkHours } from "@/lib/time-clock-rules";

// Weekly payroll view built from time_shifts and job_time_entries. Pure, so it can be tested.
// Gusto still does the pay math; this is the hours file and the check before it goes in.

export type StaffRow = { id: string; name: string | null; email: string | null };
export type ShiftRow = {
  id: string;
  staff_id: string;
  started_at: string;
  ended_at: string | null;
  break_minutes: number;
  flagged: boolean;
  reviewed_at: string | null;
  /** Set when the office voided it (SQL 0078). A voided row counts for nothing. */
  voided_at?: string | null;
};
export type EntryRow = {
  id: string;
  job_id: string;
  staff_id: string;
  kind: string;
  started_at: string;
  ended_at: string | null;
  flagged: boolean;
  reviewed_at: string | null;
  voided_at?: string | null;
};

export type StaffWeek = {
  staffId: string;
  name: string;
  email: string;
  paidHours: number;
  regular: number;
  overtime: number;
  breakMinutes: number;
  jobHours: number;
  driveHours: number;
  /** Paid shift time not on a job or on the road: shop, supplier runs, paperwork. */
  otherHours: number;
  openShift: boolean;
  flagged: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function buildWeekReport(staff: StaffRow[], shifts: ShiftRow[], entries: EntryRow[]): StaffWeek[] {
  const rows: StaffWeek[] = [];
  for (const person of staff) {
    // A voided row stays on /hours (greyed) but counts for nothing: not paid, not a flag.
    const myShifts = shifts.filter((s) => s.staff_id === person.id && !s.voided_at);
    const myEntries = entries.filter((e) => e.staff_id === person.id && !e.voided_at);
    if (myShifts.length === 0 && myEntries.length === 0) continue;

    const closed = myShifts.filter((s) => s.ended_at);
    const paidHours = r2(closed.reduce((sum, s) => sum + paidShiftHours(s.started_at, s.ended_at as string, s.break_minutes), 0));
    const breakMinutes = closed.reduce((sum, s) => sum + s.break_minutes, 0);
    const jobHours = sumWorkHours(myEntries);
    const driveHours = r2(
      myEntries
        .filter((e) => e.kind === "drive" && e.ended_at)
        .reduce((sum, e) => sum + hoursBetween(e.started_at, e.ended_at as string), 0)
    );
    const { regular, overtime } = splitOvertime(paidHours);
    rows.push({
      staffId: person.id,
      name: person.name?.trim() || person.email || "Staff",
      email: person.email ?? "",
      paidHours,
      regular,
      overtime,
      breakMinutes,
      jobHours,
      driveHours,
      otherHours: Math.max(0, r2(paidHours - jobHours - driveHours)),
      openShift: myShifts.some((s) => !s.ended_at),
      flagged:
        myShifts.filter((s) => s.flagged && !s.reviewed_at).length +
        myEntries.filter((e) => e.flagged && !e.reviewed_at).length,
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * One line per person for the week. Column names are plain; if Gusto's import template wants
 * different headings, rename them here after checking the template with one real pay period.
 */
export function weekCsv(weekStart: string, rows: StaffWeek[]): string {
  const header = [
    "Employee",
    "Email",
    "Week start (Mon)",
    "Regular hours",
    "Overtime hours",
    "Meal break minutes",
    "Hours on jobs",
    "Drive hours",
    "Other paid hours",
    "Unreviewed flags",
  ];
  const lines = rows.map((r) =>
    [r.name, r.email, weekStart, r.regular, r.overtime, r.breakMinutes, r.jobHours, r.driveHours, r.otherHours, r.flagged]
      .map(csvCell)
      .join(",")
  );
  return [header.map(csvCell).join(","), ...lines].join("\n") + "\n";
}
