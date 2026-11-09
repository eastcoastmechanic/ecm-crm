// Pure rules for office time edits on /hours (edit, add missed time, void). No database, so
// they are easy to test. The database side is lib/time-edit.ts.

export type TimeTable = "time_shifts" | "job_time_entries";
export const TIME_TABLES: TimeTable[] = ["time_shifts", "job_time_entries"];
export type TimeEditAction = "edit" | "add" | "void" | "pause" | "resume";

/** No single shift or job timer can be longer than this. */
export const MAX_EDIT_HOURS = 16;
/** Reasons are short notes, not essays. */
export const MAX_REASON_LENGTH = 200;
export const MAX_BREAK_MINUTES = 480;

const HOUR_MS = 3600000;

/** Any row of time_shifts or job_time_entries, as far as these rules care. */
export type TimeSpan = {
  id: string;
  started_at: string;
  ended_at: string | null;
  voided_at?: string | null;
};

export function isVoided(row: { voided_at?: string | null }): boolean {
  return !!row.voided_at;
}

/** Drops voided rows. Payroll, totals, the Gusto file and tracked hours all start here. */
export function liveRows<T extends { voided_at?: string | null }>(rows: T[]): T[] {
  return rows.filter((r) => !isVoided(r));
}

/** A required short reason, trimmed. Error text when missing or too long. */
export function readReason(value: unknown): { reason: string } | { error: string } {
  const reason = String(value ?? "").trim();
  if (!reason) return { error: "Add a short reason for the change." };
  if (reason.length > MAX_REASON_LENGTH) return { error: `Keep the reason under ${MAX_REASON_LENGTH} characters.` };
  return { reason };
}

/** Whole minutes from a form field. Blank is 0. Null when it is not a whole number in range. */
export function readBreakMinutes(value: unknown): number | null {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return n >= 0 && n <= MAX_BREAK_MINUTES ? n : null;
}

/** Two spans overlap when each starts before the other ends. An open span runs to `now`. */
function overlaps(aStart: number, aEnd: number, b: TimeSpan, now: Date): boolean {
  const bStart = new Date(b.started_at).getTime();
  const bEnd = b.ended_at ? new Date(b.ended_at).getTime() : now.getTime();
  return aStart < bEnd && bStart < aEnd;
}

export type RangeCheck = {
  table: TimeTable;
  start: Date;
  /** Null only when an open row stays open (edit of a running shift or timer). */
  end: Date | null;
  breakMinutes?: number;
  now: Date;
  /** The same person's other rows of the same table (shifts for a shift, job timers for a timer). */
  others: TimeSpan[];
  /** The row being edited, left out of the overlap check. */
  selfId?: string;
};

/**
 * Error text for a start/end the office typed, or null when it is fine:
 * end after start, nothing in the future, at most 16 hours, a meal break shorter than the shift,
 * and no overlap with that person's other (not voided) shifts, or other job timers for a timer.
 */
export function checkTimeRange(c: RangeCheck): string | null {
  const start = c.start.getTime();
  const now = c.now.getTime();
  if (Number.isNaN(start)) return "Enter a start time.";
  if (start > now) return "The start time is in the future.";
  if (c.end) {
    const end = c.end.getTime();
    if (Number.isNaN(end)) return "Enter an end time.";
    if (end <= start) return "The end time must be after the start time.";
    if (end > now) return "The end time is in the future.";
  }
  const end = c.end ? c.end.getTime() : now;
  if (end - start > MAX_EDIT_HOURS * HOUR_MS) {
    return `That is over ${MAX_EDIT_HOURS} hours. Split it or check the dates.`;
  }
  if (c.table === "time_shifts" && c.end && (c.breakMinutes ?? 0) * 60000 >= end - start) {
    return "The meal break is as long as the shift.";
  }
  const clash = c.others.find((o) => o.id !== c.selfId && !isVoided(o) && overlaps(start, end, o, c.now));
  if (clash) {
    return c.table === "time_shifts"
      ? "That overlaps another day shift for this person. Fix or void that one first."
      : "That overlaps another job timer for this person. Fix or void that one first.";
  }
  return null;
}

const SNAPSHOT_FIELDS = [
  "staff_id",
  "job_id",
  "kind",
  "started_at",
  "ended_at",
  "break_minutes",
  "note",
  "source",
  "voided_at",
  "voided_reason",
] as const;

/** The time fields of a row, for the audit log's before/after. Fields the row lacks are left out. */
export function timeSnapshot(row: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!row) return null;
  const out: Record<string, unknown> = {};
  for (const key of SNAPSHOT_FIELDS) if (key in row) out[key] = row[key];
  return out;
}

export type TimeEditRecord = {
  table_name: TimeTable;
  row_id: string;
  action: TimeEditAction;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  edited_by: string | null;
};

/** One time_edits row. `after` is the old row with the change laid over it. */
export function timeEditRecord(input: {
  table: TimeTable;
  rowId: string;
  action: TimeEditAction;
  before: Record<string, unknown> | null;
  change: Record<string, unknown>;
  reason: string | null;
  editedBy: string | null;
}): TimeEditRecord {
  const before = timeSnapshot(input.before);
  return {
    table_name: input.table,
    row_id: input.rowId,
    action: input.action,
    before,
    after: timeSnapshot({ ...(input.before ?? {}), ...input.change }),
    reason: input.reason,
    edited_by: input.editedBy,
  };
}

/** True when a failed write means the 0078 columns or table are not there yet. */
export function missingTimeEditSchema(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42703" || error.code === "42P01" || error.code === "PGRST204" || error.code === "PGRST205") return true;
  return /voided_|time_edits/.test(error.message ?? "");
}

/** "Edited by Sam on 11/9/2026: forgot to clock out", for the line under an edited row. */
export function editNote(edit: { action: TimeEditAction; reason: string | null }, who: string, when: string): string {
  const verb =
    edit.action === "add"
      ? "Added"
      : edit.action === "void"
        ? "Voided"
        : edit.action === "pause"
          ? "Paused"
          : edit.action === "resume"
            ? "Resumed"
            : "Edited";
  return `${verb} by ${who} on ${when}${edit.reason ? `: ${edit.reason}` : ""}`;
}
