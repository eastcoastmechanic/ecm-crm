import { supabase } from "@/lib/supabase";
import {
  ENTRY_CAP_HOURS,
  MEAL_BREAK_MINUTES,
  SHIFT_CAP_HOURS,
  autoCloseAt,
  isStale,
  shiftNeedsBreak,
  sumWorkHours,
} from "@/lib/time-clock-rules";

// Server side of the time clock: the day shift and time on each job.
// Rules (caps, break, overtime) live in time-clock-rules.ts. Tables are in 0055_time_clock.sql.
// One open shift and one open job entry per person; the database enforces it, so a double tap
// is a harmless no-op (unique violation 23505).

type Result = { error?: string };
const UNIQUE_VIOLATION = "23505";

export async function getOpenShift(staffId: string) {
  const { data } = await supabase
    .from("time_shifts")
    .select("id, started_at")
    .eq("staff_id", staffId)
    .is("ended_at", null)
    .maybeSingle();
  return data as { id: string; started_at: string } | null;
}

export async function clockIn(staffId: string): Promise<Result> {
  if (await getOpenShift(staffId)) return {};
  const { error } = await supabase.from("time_shifts").insert({ staff_id: staffId, source: "app" });
  if (error && error.code !== UNIQUE_VIOLATION) return { error: "Could not clock you in. Try again." };
  return {};
}

/** Returns the open shift id, starting one (and flagging it) if the tech never clocked in. */
async function ensureShift(staffId: string): Promise<string | null> {
  const open = await getOpenShift(staffId);
  if (open) return open.id;
  const { data, error } = await supabase
    .from("time_shifts")
    .insert({
      staff_id: staffId,
      source: "auto",
      flagged: true,
      flag_reason: "No clock in. Started when the first job step was tapped.",
    })
    .select("id")
    .single();
  if (error) return (await getOpenShift(staffId))?.id ?? null;
  return data.id as string;
}

async function closeOpenEntry(staffId: string, endedAt: Date, flagReason?: string, note?: string) {
  const { data: open } = await supabase
    .from("job_time_entries")
    .select("id")
    .eq("staff_id", staffId)
    .is("ended_at", null)
    .maybeSingle();
  if (!open) return;
  await supabase
    .from("job_time_entries")
    .update({
      ended_at: endedAt.toISOString(),
      ...(flagReason ? { flagged: true, flag_reason: flagReason } : {}),
      ...(note ? { note } : {}),
    })
    .eq("id", open.id);
}

export async function clockOut(staffId: string, breakMinutes: number | null): Promise<Result> {
  const shift = await getOpenShift(staffId);
  if (!shift) return { error: "You are not clocked in." };
  const now = new Date();

  const needsBreak = shiftNeedsBreak(shift.started_at, now);
  if (needsBreak && breakMinutes === null) {
    return { error: "This shift is over 6 hours. Enter your meal break in minutes (0 if you took none)." };
  }
  if (breakMinutes !== null && (!Number.isFinite(breakMinutes) || breakMinutes < 0 || breakMinutes > 480)) {
    return { error: "Meal break must be between 0 and 480 minutes." };
  }

  // A job still running when the day ends is closed with the shift and flagged for the office.
  await closeOpenEntry(staffId, now, "Still running when the tech clocked out.");

  const shortBreak = needsBreak && (breakMinutes ?? 0) < MEAL_BREAK_MINUTES;
  const { error } = await supabase
    .from("time_shifts")
    .update({
      ended_at: now.toISOString(),
      break_minutes: breakMinutes ?? 0,
      ...(shortBreak ? { flagged: true, flag_reason: "Over 6 hours with less than a 30 minute meal break." } : {}),
    })
    .eq("id", shift.id);
  if (error) return { error: "Could not clock you out. Try again." };
  return {};
}

/** Start time on a job. Closes whatever the tech had running first (one thing at a time). */
export async function startJobEntry(jobId: string, staffId: string, kind: "work" | "drive"): Promise<Result> {
  const shiftId = await ensureShift(staffId);
  const now = new Date();

  const { data: open } = await supabase
    .from("job_time_entries")
    .select("id, job_id, kind")
    .eq("staff_id", staffId)
    .is("ended_at", null)
    .maybeSingle();
  if (open?.job_id === jobId && open.kind === kind) return {};
  if (open) {
    // Drive to work on the same job is the normal hand-off. Anything else means a step was missed.
    const normal = open.job_id === jobId && open.kind === "drive" && kind === "work";
    await closeOpenEntry(staffId, now, normal ? undefined : "Closed when the next job step started.");
  }

  const { error } = await supabase
    .from("job_time_entries")
    .insert({ job_id: jobId, staff_id: staffId, shift_id: shiftId, kind, started_at: now.toISOString() });
  if (error && error.code !== UNIQUE_VIOLATION) return { error: "Could not start the job timer." };
  return {};
}

/** Pause: close the open work entry, marked so the card can show Resume. */
export async function pauseJobEntry(jobId: string, staffId: string): Promise<Result> {
  const { data: open } = await supabase
    .from("job_time_entries")
    .select("id")
    .eq("staff_id", staffId)
    .eq("job_id", jobId)
    .eq("kind", "work")
    .is("ended_at", null)
    .maybeSingle();
  if (!open) return {};
  const { error } = await supabase
    .from("job_time_entries")
    .update({ ended_at: new Date().toISOString(), note: "paused" })
    .eq("id", open.id);
  return error ? { error: "Could not pause." } : {};
}

/**
 * Called when a job is completed (any path: truck, Jobs page, field bot). Closes every open
 * entry on the job at the completion time and returns the work hours, or null when the job
 * has no work entries (an older job, or one finished by the office): the caller then keeps
 * the old on-site calculation.
 */
export async function finalizeJobTime(jobId: string, completedAt: string): Promise<number | null> {
  const { error: closeError } = await supabase
    .from("job_time_entries")
    .update({ ended_at: completedAt })
    .eq("job_id", jobId)
    .is("ended_at", null);
  if (closeError) console.error(`[time-clock] could not close entries for job ${jobId}: ${closeError.message}`);

  const { data } = await supabase
    .from("job_time_entries")
    .select("kind, started_at, ended_at")
    .eq("job_id", jobId);
  const entries = (data ?? []) as { kind: string; started_at: string; ended_at: string | null }[];
  if (!entries.some((e) => e.kind === "work")) return null;
  return sumWorkHours(entries);
}

export type ClockState = {
  shiftStartedAt: string | null;
  openEntry: { jobId: string; kind: "work" | "drive" } | null;
  pausedJobIds: string[];
};

/** What the truck screen needs to draw the clock bar and the Pause / Resume button. */
export async function getClockState(staffId: string): Promise<ClockState> {
  const [shift, { data: open }, { data: recent }] = await Promise.all([
    getOpenShift(staffId),
    supabase
      .from("job_time_entries")
      .select("job_id, kind")
      .eq("staff_id", staffId)
      .is("ended_at", null)
      .maybeSingle(),
    supabase
      .from("job_time_entries")
      .select("job_id, note, started_at")
      .eq("staff_id", staffId)
      .eq("kind", "work")
      .not("ended_at", "is", null)
      .order("started_at", { ascending: false })
      .limit(20),
  ]);

  // A job counts as paused when my latest work entry on it was closed by Pause and nothing is running.
  const latestByJob = new Map<string, string | null>();
  for (const row of (recent ?? []) as { job_id: string; note: string | null }[]) {
    if (!latestByJob.has(row.job_id)) latestByJob.set(row.job_id, row.note);
  }
  const pausedJobIds = open ? [] : [...latestByJob].filter(([, note]) => note === "paused").map(([id]) => id);

  return {
    shiftStartedAt: shift?.started_at ?? null,
    openEntry: open ? { jobId: open.job_id as string, kind: open.kind as "work" | "drive" } : null,
    pausedJobIds,
  };
}

/** Daily cleanup: close anything left open past its cap and flag it for the office. */
export async function closeStaleTime(now: Date = new Date()): Promise<{ shifts: number; entries: number }> {
  let shifts = 0;
  let entries = 0;

  const { data: openShifts } = await supabase.from("time_shifts").select("id, started_at").is("ended_at", null);
  for (const s of (openShifts ?? []) as { id: string; started_at: string }[]) {
    if (!isStale(s.started_at, SHIFT_CAP_HOURS, now)) continue;
    const { error } = await supabase
      .from("time_shifts")
      .update({
        ended_at: autoCloseAt(s.started_at, SHIFT_CAP_HOURS).toISOString(),
        auto_closed: true,
        flagged: true,
        flag_reason: `Never clocked out. Closed after ${SHIFT_CAP_HOURS} hours. Office: fix the end time.`,
      })
      .eq("id", s.id)
      .is("ended_at", null);
    if (!error) shifts += 1;
  }

  const { data: openEntries } = await supabase.from("job_time_entries").select("id, started_at").is("ended_at", null);
  for (const e of (openEntries ?? []) as { id: string; started_at: string }[]) {
    if (!isStale(e.started_at, ENTRY_CAP_HOURS, now)) continue;
    const { error } = await supabase
      .from("job_time_entries")
      .update({
        ended_at: autoCloseAt(e.started_at, ENTRY_CAP_HOURS).toISOString(),
        auto_closed: true,
        flagged: true,
        flag_reason: `Never finished. Closed after ${ENTRY_CAP_HOURS} hours. Office: fix the end time.`,
      })
      .eq("id", e.id)
      .is("ended_at", null);
    if (!error) entries += 1;
  }

  return { shifts, entries };
}
