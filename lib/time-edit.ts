import { supabase } from "@/lib/supabase";
import { chunk } from "@/lib/fetch-all";
import { parseEtLocal } from "@/lib/tz";
import { getOpenShift, pauseJobEntry, recomputeTrackedHours, startJobEntry } from "@/lib/time-clock";
import {
  checkTimeRange,
  isVoided,
  missingTimeEditSchema,
  readBreakMinutes,
  readReason,
  timeEditRecord,
  type TimeEditRecord,
  type TimeSpan,
  type TimeTable,
} from "@/lib/time-edit-rules";

// Office changes to clocked time: edit, add missed time, void (on /hours), and pause / resume a
// tech's job timer (on /jobs). Every change is logged to time_edits (SQL 0078) with who, why,
// before and after. Pause / resume go through the same helpers as the truck card.
// Before 0078 runs, edits still save (the audit row is skipped and logged) and Void says to run it.

type Result = { error?: string };
type Row = Record<string, unknown> & TimeSpan & { staff_id: string; job_id?: string; kind?: string };

const HOUR_MS = 3600000;
const CLOSED_JOB_STATUSES = ["complete", "completed", "cancelled", "canceled"];

/** Saves one audit row. A failure (for example before SQL 0078) is logged, never shown as a failed edit. */
export async function logTimeEdit(record: TimeEditRecord): Promise<void> {
  try {
    const { error } = await supabase.from("time_edits").insert(record);
    if (error) console.error(`[time-edit] audit row not saved (${record.action} ${record.table_name}): ${error.message}`);
  } catch (e) {
    console.error(`[time-edit] audit row not saved: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function loadRow(table: TimeTable, id: string): Promise<Row | null> {
  const { data } = await supabase.from(table).select("*").eq("id", id).maybeSingle();
  return (data as Row | null) ?? null;
}

/** The person's rows of one table that could overlap a span starting at `start` (rows are capped well under a day). */
async function nearbyRows(table: TimeTable, staffId: string, start: Date, end: Date | null): Promise<TimeSpan[] | null> {
  const to = end ?? new Date();
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("staff_id", staffId)
    .gte("started_at", new Date(start.getTime() - 24 * HOUR_MS).toISOString())
    .lt("started_at", to.toISOString());
  if (error) return null;
  return (data ?? []) as TimeSpan[];
}

async function afterEntryChange(table: TimeTable, jobId: unknown) {
  if (table === "job_time_entries" && typeof jobId === "string" && jobId) await recomputeTrackedHours(jobId);
}

function readKind(value: unknown): "work" | "drive" | null {
  const kind = String(value ?? "");
  return kind === "work" || kind === "drive" ? kind : null;
}

export type EditInput = {
  table: TimeTable;
  id: string;
  start: string;
  /** Blank keeps a running row running. A finished row needs an end. */
  end: string;
  breakMinutes?: string;
  kind?: string;
  reason: string;
  editedBy: string | null;
  now?: Date;
};

/** Office edits a shift (start, end, meal break) or a job timer (start, end, work/drive). */
export async function editTime(input: EditInput): Promise<Result> {
  const now = input.now ?? new Date();
  const reason = readReason(input.reason);
  if ("error" in reason) return reason;

  const row = await loadRow(input.table, input.id);
  if (!row) return { error: "That time entry is gone. Reload the page." };
  if (isVoided(row)) return { error: "That entry is voided. Add the time again instead." };

  const start = parseEtLocal(input.start);
  if (!start) return { error: "Enter a start time." };
  let end: Date | null = null;
  if (input.end.trim()) {
    end = parseEtLocal(input.end);
    if (!end) return { error: "The end time could not be read." };
  } else if (row.ended_at) {
    return { error: "Enter an end time." };
  }

  const change: Record<string, unknown> = { started_at: start.toISOString(), ended_at: end ? end.toISOString() : null };
  let breakMinutes = 0;
  if (input.table === "time_shifts") {
    const parsed = readBreakMinutes(input.breakMinutes);
    if (parsed === null) return { error: "Meal break must be whole minutes between 0 and 480." };
    breakMinutes = parsed;
    change.break_minutes = breakMinutes;
  } else {
    const kind = readKind(input.kind);
    if (!kind) return { error: "Pick work or drive." };
    change.kind = kind;
  }

  const others = await nearbyRows(input.table, row.staff_id, start, end);
  if (!others) return { error: "Could not check this person's other time. Try again." };
  const problem = checkTimeRange({ table: input.table, start, end, breakMinutes, now, others, selfId: row.id });
  if (problem) return { error: problem };

  const unchanged = Object.entries(change).every(([key, value]) =>
    key === "started_at" || key === "ended_at"
      ? (row[key] ? new Date(row[key] as string).getTime() : null) === (value ? new Date(value as string).getTime() : null)
      : row[key] === value
  );
  if (unchanged) return { error: "Nothing changed." };

  // The office has looked at it now, so a flag on it is cleared from "Needs a look".
  const { error } = await supabase
    .from(input.table)
    .update({ ...change, source: "office", reviewed_at: now.toISOString() })
    .eq("id", row.id);
  if (error) return { error: "Could not save the change. Try again." };

  await logTimeEdit(
    timeEditRecord({ table: input.table, rowId: row.id, action: "edit", before: row, change: { ...change, source: "office" }, reason: reason.reason, editedBy: input.editedBy })
  );
  await afterEntryChange(input.table, row.job_id);
  return {};
}

export type AddInput = {
  table: TimeTable;
  staffId: string;
  jobId?: string;
  kind?: string;
  start: string;
  end: string;
  breakMinutes?: string;
  reason: string;
  editedBy: string | null;
  now?: Date;
};

/** Office adds time a person forgot to clock: a day shift, or a job timer on a chosen job. */
export async function addTime(input: AddInput): Promise<Result> {
  const now = input.now ?? new Date();
  const reason = readReason(input.reason);
  if ("error" in reason) return reason;
  if (!input.staffId) return { error: "Pick who the time is for." };

  const start = parseEtLocal(input.start);
  if (!start) return { error: "Enter a start time." };
  const end = parseEtLocal(input.end);
  if (!end) return { error: "Enter an end time." };

  const { data: person } = await supabase.from("staff").select("id").eq("id", input.staffId).maybeSingle();
  if (!person) return { error: "That staff member was not found." };

  const insert: Record<string, unknown> = {
    staff_id: input.staffId,
    started_at: start.toISOString(),
    ended_at: end.toISOString(),
    source: "office",
    reviewed_at: now.toISOString(),
  };
  let breakMinutes = 0;
  if (input.table === "time_shifts") {
    const parsed = readBreakMinutes(input.breakMinutes);
    if (parsed === null) return { error: "Meal break must be whole minutes between 0 and 480." };
    breakMinutes = parsed;
    insert.break_minutes = breakMinutes;
  } else {
    const kind = readKind(input.kind);
    if (!kind) return { error: "Pick work or drive." };
    if (!input.jobId) return { error: "Pick the job." };
    const { data: job } = await supabase.from("jobs").select("id").eq("id", input.jobId).maybeSingle();
    if (!job) return { error: "That job was not found." };
    insert.job_id = input.jobId;
    insert.kind = kind;
  }

  const others = await nearbyRows(input.table, input.staffId, start, end);
  if (!others) return { error: "Could not check this person's other time. Try again." };
  const problem = checkTimeRange({ table: input.table, start, end, breakMinutes, now, others });
  if (problem) return { error: problem };

  if (input.table === "job_time_entries") {
    // Tie the timer to the day shift it falls in, when there is one.
    const shifts = await nearbyRows("time_shifts", input.staffId, start, end);
    const t = start.getTime();
    const home = (shifts ?? []).find(
      (s) => !isVoided(s) && new Date(s.started_at).getTime() <= t && (!s.ended_at || new Date(s.ended_at).getTime() >= t)
    );
    if (home) insert.shift_id = home.id;
  }

  const { data, error } = await supabase.from(input.table).insert(insert).select("*").single();
  if (error || !data) return { error: "Could not add the time. Try again." };
  const added = data as Row;

  await logTimeEdit(
    timeEditRecord({ table: input.table, rowId: added.id, action: "add", before: null, change: added, reason: reason.reason, editedBy: input.editedBy })
  );
  await afterEntryChange(input.table, added.job_id);
  return {};
}

/** Office voids a shift or job timer. The row stays (greyed on /hours) but counts for nothing. */
export async function voidTime(input: {
  table: TimeTable;
  id: string;
  reason: string;
  editedBy: string | null;
  now?: Date;
}): Promise<Result> {
  const now = input.now ?? new Date();
  const reason = readReason(input.reason);
  if ("error" in reason) return reason;

  const row = await loadRow(input.table, input.id);
  if (!row) return { error: "That time entry is gone. Reload the page." };
  if (isVoided(row)) return { error: "That entry is already voided." };
  if (!row.ended_at) return { error: "That one is still running. Give it an end time (Edit) or pause it first." };

  const change = { voided_at: now.toISOString(), voided_reason: reason.reason };
  const { error } = await supabase
    .from(input.table)
    .update({ ...change, reviewed_at: now.toISOString() })
    .eq("id", row.id);
  if (error) {
    if (missingTimeEditSchema(error)) return { error: "Run SQL 0078 to void entries." };
    return { error: "Could not void it. Try again." };
  }

  await logTimeEdit(
    timeEditRecord({ table: input.table, rowId: row.id, action: "void", before: row, change, reason: reason.reason, editedBy: input.editedBy })
  );
  await afterEntryChange(input.table, row.job_id);
  return {};
}

async function openWorkEntry(jobId: string, staffId: string): Promise<Row | null> {
  const { data } = await supabase
    .from("job_time_entries")
    .select("*")
    .eq("staff_id", staffId)
    .eq("job_id", jobId)
    .eq("kind", "work")
    .is("ended_at", null)
    .maybeSingle();
  return (data as Row | null) ?? null;
}

/** Office pauses a tech's running work timer on a job, the same way the truck card's Pause does. */
export async function officePauseJob(jobId: string, staffId: string, editedBy: string | null): Promise<Result> {
  const open = await openWorkEntry(jobId, staffId);
  if (!open) return { error: "That timer is not running any more. Reload the page." };

  const paused = await pauseJobEntry(jobId, staffId);
  if (paused.error) return paused;

  const after = await loadRow("job_time_entries", open.id);
  await logTimeEdit(
    timeEditRecord({
      table: "job_time_entries",
      rowId: open.id,
      action: "pause",
      before: open,
      change: { ended_at: after?.ended_at ?? null, note: after?.note ?? "paused" },
      reason: null,
      editedBy,
    })
  );
  await recomputeTrackedHours(jobId);
  return {};
}

/** Office resumes a tech's paused job, the same way the truck card's Resume does. */
export async function officeResumeJob(jobId: string, staffId: string, editedBy: string | null): Promise<Result> {
  const { data: job } = await supabase.from("jobs").select("id, status").eq("id", jobId).maybeSingle();
  if (!job) return { error: "That job was not found." };
  if (CLOSED_JOB_STATUSES.includes(String(job.status))) return { error: "The job is finished or cancelled." };

  // Resume from the office never starts a day shift or stops another job behind the tech's back.
  if (!(await getOpenShift(staffId))) {
    return { error: "This tech is not clocked in. A job timer only runs while they are on the clock." };
  }
  const { data: running } = await supabase
    .from("job_time_entries")
    .select("job_id, kind")
    .eq("staff_id", staffId)
    .is("ended_at", null)
    .maybeSingle();
  if (running && running.job_id !== jobId) {
    return { error: "This tech has a timer running on another job. Pause that one first." };
  }
  if (running && running.kind === "work") return { error: "That timer is already running." };

  const started = await startJobEntry(jobId, staffId, "work");
  if (started.error) return started;

  const now = await openWorkEntry(jobId, staffId);
  if (now) {
    await logTimeEdit(
      timeEditRecord({ table: "job_time_entries", rowId: now.id, action: "resume", before: null, change: now, reason: null, editedBy })
    );
  }
  return {};
}

export type JobTimer = {
  staffId: string;
  state: "running" | "paused";
  /** When the running timer started, or when the paused one stopped. */
  since: string;
};

/**
 * Running or paused work timers per job, for the Jobs page. A tech's timer on a job is running
 * when their latest work entry there is open, and paused when it was closed by Pause (note
 * "paused") and is not voided. Read failures give an empty map (the buttons just don't show).
 */
export async function listJobTimers(jobIds: string[]): Promise<Map<string, JobTimer[]>> {
  const out = new Map<string, JobTimer[]>();
  if (jobIds.length === 0) return out;
  const results = await Promise.all(
    chunk(jobIds).map((ids) =>
      supabase
        .from("job_time_entries")
        .select("*")
        .eq("kind", "work")
        .in("job_id", ids)
        .order("started_at", { ascending: false })
    )
  );
  const rows: Row[] = [];
  for (const r of results) {
    if (r.error) {
      console.error(`[time-edit] job timers read failed: ${r.error.message}`);
      continue;
    }
    rows.push(...((r.data ?? []) as Row[]));
  }
  const seen = new Set<string>();
  for (const row of rows) {
    if (isVoided(row) || !row.job_id) continue;
    const key = `${row.job_id}:${row.staff_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const state = !row.ended_at ? "running" : row.note === "paused" ? "paused" : null;
    if (!state) continue;
    const list = out.get(row.job_id) ?? [];
    list.push({ staffId: row.staff_id, state, since: (row.ended_at ?? row.started_at) as string });
    out.set(row.job_id, list);
  }
  return out;
}
