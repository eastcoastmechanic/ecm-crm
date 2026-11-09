import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Call, Handler } from "./fake-supabase";
import { has, payload } from "./fake-supabase";

const h = vi.hoisted(() => ({
  calls: [] as Call[],
  handler: (() => ({})) as Handler,
  recompute: vi.fn(),
  pause: vi.fn(),
  start: vi.fn(),
  openShift: null as { id: string; started_at: string } | null,
}));

vi.mock("@/lib/supabase", async () => {
  const { fakeSupabase } = await import("./fake-supabase");
  const fake = fakeSupabase((call) => {
    h.calls.push(call);
    return h.handler(call);
  });
  return { supabase: fake.client };
});

vi.mock("@/lib/time-clock", () => ({
  recomputeTrackedHours: (jobId: string) => {
    h.recompute(jobId);
    return Promise.resolve();
  },
  pauseJobEntry: (jobId: string, staffId: string) => {
    h.pause(jobId, staffId);
    return Promise.resolve({});
  },
  startJobEntry: (jobId: string, staffId: string, kind: string) => {
    h.start(jobId, staffId, kind);
    return Promise.resolve({});
  },
  getOpenShift: () => Promise.resolve(h.openShift),
}));

import { addTime, editTime, listJobTimers, officePauseJob, officeResumeJob, voidTime } from "../time-edit";

const now = new Date("2026-11-05T20:00:00Z"); // Thu 3:00 PM New York (EST)

const shiftRow = {
  id: "s1",
  staff_id: "a",
  started_at: "2026-11-04T12:00:00Z", // 7:00 AM
  ended_at: "2026-11-05T02:00:00Z", // forgot to clock out
  break_minutes: 0,
  source: "auto",
  flagged: true,
  voided_at: null,
};
const entryRow = {
  id: "e1",
  staff_id: "a",
  job_id: "j1",
  kind: "work",
  started_at: "2026-11-04T13:00:00Z",
  ended_at: "2026-11-04T16:00:00Z",
  note: null,
  voided_at: null,
};

const audits = () => h.calls.filter((c) => c.table === "time_edits" && has(c, "insert")).map((c) => payload(c, "insert"));
const updates = (table: string) => h.calls.filter((c) => c.table === table && has(c, "update"));

beforeEach(() => {
  h.calls = [];
  h.recompute.mockClear();
  h.pause.mockClear();
  h.start.mockClear();
  h.openShift = null;
});

/** A handler with one row by id, some neighbours, and optional failures. */
function setup(opts: {
  table: "time_shifts" | "job_time_entries";
  row?: Record<string, unknown> | null;
  others?: Record<string, unknown>[];
  updateError?: { message: string; code?: string } | null;
  auditError?: { message: string; code?: string } | null;
  inserted?: Record<string, unknown>;
}) {
  h.handler = (call) => {
    if (call.table === "time_edits") return { error: opts.auditError ?? null };
    if (call.table === "staff") return { data: { id: "a" } };
    if (call.table === "jobs") return { data: { id: "j1", status: "in_progress" } };
    if (has(call, "update")) return { error: opts.updateError ?? null };
    if (has(call, "insert")) return { data: opts.inserted ?? null };
    if (call.end === "maybeSingle") return { data: call.table === opts.table ? (opts.row ?? null) : null };
    if (call.table === opts.table) return { data: opts.others ?? [] };
    return { data: [] };
  };
}

describe("editTime", () => {
  it("fixes a forgotten clock-out, logs before/after with the reason, and marks it reviewed", async () => {
    setup({ table: "time_shifts", row: shiftRow, others: [shiftRow] });
    const result = await editTime({
      table: "time_shifts",
      id: "s1",
      start: "2026-11-04T07:00",
      end: "2026-11-04T15:30",
      breakMinutes: "30",
      reason: "Forgot to clock out",
      editedBy: "owner-1",
      now,
    });
    expect(result).toEqual({});
    const [update] = updates("time_shifts");
    expect(payload(update, "update")).toMatchObject({
      started_at: "2026-11-04T12:00:00.000Z",
      ended_at: "2026-11-04T20:30:00.000Z",
      break_minutes: 30,
      source: "office",
      reviewed_at: now.toISOString(),
    });
    expect(has(update, "eq", "id", "s1")).toBe(true);
    const [audit] = audits();
    expect(audit).toMatchObject({
      table_name: "time_shifts",
      row_id: "s1",
      action: "edit",
      reason: "Forgot to clock out",
      edited_by: "owner-1",
      before: { ended_at: "2026-11-05T02:00:00Z", break_minutes: 0, source: "auto" },
      after: { ended_at: "2026-11-04T20:30:00.000Z", break_minutes: 30, source: "office" },
    });
    expect(h.recompute).not.toHaveBeenCalled(); // shifts carry no job
  });

  it("refuses an overlap with another shift and changes nothing", async () => {
    const other = { id: "s2", staff_id: "a", started_at: "2026-11-04T19:00:00Z", ended_at: "2026-11-04T23:00:00Z" };
    setup({ table: "time_shifts", row: shiftRow, others: [shiftRow, other] });
    const result = await editTime({
      table: "time_shifts", id: "s1", start: "2026-11-04T07:00", end: "2026-11-04T15:30", reason: "fix", editedBy: null, now,
    });
    expect(result.error).toMatch(/overlaps another day shift/);
    expect(updates("time_shifts")).toHaveLength(0);
    expect(audits()).toHaveLength(0);
  });

  it("needs a reason", async () => {
    setup({ table: "time_shifts", row: shiftRow });
    const result = await editTime({ table: "time_shifts", id: "s1", start: "2026-11-04T07:00", end: "2026-11-04T15:30", reason: " ", editedBy: null, now });
    expect(result.error).toMatch(/reason/);
    expect(h.calls).toHaveLength(0);
  });

  it("refuses a voided row", async () => {
    setup({ table: "time_shifts", row: { ...shiftRow, voided_at: "2026-11-05T12:00:00Z" } });
    const result = await editTime({ table: "time_shifts", id: "s1", start: "2026-11-04T07:00", end: "2026-11-04T15:30", reason: "x", editedBy: null, now });
    expect(result.error).toMatch(/voided/);
  });

  it("re-figures the job's tracked hours after a job timer edit, and still saves when the audit table is missing", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    setup({ table: "job_time_entries", row: entryRow, others: [entryRow], auditError: { code: "42P01", message: 'relation "time_edits" does not exist' } });
    const result = await editTime({
      table: "job_time_entries", id: "e1", start: "2026-11-04T08:00", end: "2026-11-04T10:00", kind: "drive", reason: "was driving", editedBy: null, now,
    });
    expect(result).toEqual({});
    expect(payload(updates("job_time_entries")[0], "update")).toMatchObject({ kind: "drive", ended_at: "2026-11-04T15:00:00.000Z" });
    expect(h.recompute).toHaveBeenCalledWith("j1");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("editTime on a finished job", () => {
  it("sets tracked hours to 0 when the last work timer becomes drive", async () => {
    h.handler = (call) => {
      if (call.table === "time_edits") return {};
      if (call.table === "jobs") return { data: { status: "complete" } };
      if (has(call, "update")) return {};
      if (call.end === "maybeSingle") return { data: entryRow };
      if (has(call, "limit")) return { data: [] }; // no work entries left
      return { data: [entryRow] };
    };
    const result = await editTime({
      table: "job_time_entries", id: "e1", start: "2026-11-04T08:00", end: "2026-11-04T11:00", kind: "drive", reason: "was driving", editedBy: null, now,
    });
    expect(result).toEqual({});
    expect(h.recompute).toHaveBeenCalledWith("j1");
    const jobUpdate = h.calls.find((c) => c.table === "jobs" && has(c, "update"));
    expect(payload(jobUpdate!, "update")).toEqual({ tracked_hours: 0 });
  });
});

describe("listJobTimers", () => {
  it("shows running and paused timers, and nothing when the latest entry was voided", async () => {
    h.handler = () => ({
      data: [
        { id: "x1", job_id: "j1", staff_id: "a", kind: "work", started_at: "2026-11-05T15:00:00Z", ended_at: null },
        { id: "x2", job_id: "j2", staff_id: "a", kind: "work", started_at: "2026-11-05T13:00:00Z", ended_at: "2026-11-05T14:00:00Z", note: "paused" },
        { id: "x3", job_id: "j3", staff_id: "a", kind: "work", started_at: "2026-11-05T12:00:00Z", ended_at: "2026-11-05T12:30:00Z", voided_at: "x" },
        { id: "x4", job_id: "j3", staff_id: "a", kind: "work", started_at: "2026-11-05T11:00:00Z", ended_at: "2026-11-05T11:30:00Z", note: "paused" },
      ],
    });
    const map = await listJobTimers(["j1", "j2", "j3"]);
    expect(map.get("j1")).toEqual([{ staffId: "a", state: "running", since: "2026-11-05T15:00:00Z" }]);
    expect(map.get("j2")).toEqual([{ staffId: "a", state: "paused", since: "2026-11-05T14:00:00Z" }]);
    expect(map.has("j3")).toBe(false);
  });
});

describe("addTime", () => {
  it("adds a missed job timer, ties it to the day shift, logs it and re-figures the job", async () => {
    const added = { ...entryRow, id: "e9", source: "office" };
    h.handler = (call) => {
      if (call.table === "time_edits") return {};
      if (call.table === "staff" || call.table === "jobs") return { data: { id: call.table === "jobs" ? "j1" : "a" } };
      if (has(call, "insert")) return { data: added };
      if (call.table === "time_shifts") return { data: [shiftRow] };
      return { data: [] }; // no other job timers
    };
    const result = await addTime({
      table: "job_time_entries", staffId: "a", jobId: "j1", kind: "work", start: "2026-11-04T08:00", end: "2026-11-04T11:00", reason: "Forgot to tap I'm here", editedBy: "owner-1", now,
    });
    expect(result).toEqual({});
    const insert = h.calls.find((c) => c.table === "job_time_entries" && has(c, "insert"));
    expect(payload(insert!, "insert")).toMatchObject({
      staff_id: "a",
      job_id: "j1",
      kind: "work",
      shift_id: "s1",
      started_at: "2026-11-04T13:00:00.000Z",
      ended_at: "2026-11-04T16:00:00.000Z",
      source: "office",
    });
    expect(audits()[0]).toMatchObject({ action: "add", row_id: "e9", before: null, after: { job_id: "j1", kind: "work" }, edited_by: "owner-1" });
    expect(h.recompute).toHaveBeenCalledWith("j1");
  });

  it("refuses a missed shift in the future", async () => {
    setup({ table: "time_shifts" });
    const result = await addTime({ table: "time_shifts", staffId: "a", start: "2026-11-05T14:00", end: "2026-11-05T18:00", reason: "r", editedBy: null, now });
    expect(result.error).toMatch(/future/);
    expect(h.calls.some((c) => has(c, "insert"))).toBe(false);
  });
});

describe("voidTime", () => {
  it("voids a row with the reason, logs it and re-figures the job", async () => {
    setup({ table: "job_time_entries", row: entryRow });
    const result = await voidTime({ table: "job_time_entries", id: "e1", reason: "Test entry", editedBy: "owner-1", now });
    expect(result).toEqual({});
    expect(payload(updates("job_time_entries")[0], "update")).toEqual({
      voided_at: now.toISOString(),
      voided_reason: "Test entry",
      reviewed_at: now.toISOString(),
    });
    expect(audits()[0]).toMatchObject({ action: "void", before: { voided_at: null }, after: { voided_at: now.toISOString(), voided_reason: "Test entry" } });
    expect(h.recompute).toHaveBeenCalledWith("j1");
  });

  it("clears the paused mark so the truck card stops offering Resume", async () => {
    setup({ table: "job_time_entries", row: { ...entryRow, note: "paused" } });
    await voidTime({ table: "job_time_entries", id: "e1", reason: "Test", editedBy: null, now });
    expect(payload(updates("job_time_entries")[0], "update")).toMatchObject({ note: null, voided_reason: "Test" });
  });

  it("says to run SQL 0078 when the columns are missing", async () => {
    setup({ table: "time_shifts", row: shiftRow, updateError: { code: "PGRST204", message: "Could not find the 'voided_at' column of 'time_shifts'" } });
    const result = await voidTime({ table: "time_shifts", id: "s1", reason: "dup", editedBy: null, now });
    expect(result).toEqual({ error: "Run SQL 0078 to void entries." });
    expect(audits()).toHaveLength(0);
  });

  it("will not void a running row", async () => {
    setup({ table: "time_shifts", row: { ...shiftRow, ended_at: null } });
    const result = await voidTime({ table: "time_shifts", id: "s1", reason: "x", editedBy: null, now });
    expect(result.error).toMatch(/still running/);
  });
});

describe("office pause and resume", () => {
  it("pauses through the truck helper and logs who did it", async () => {
    const open = { ...entryRow, ended_at: null };
    let reads = 0;
    h.handler = (call) => {
      if (call.table === "time_edits") return {};
      if (call.end === "maybeSingle") {
        reads += 1;
        return { data: reads === 1 ? open : { ...open, ended_at: "2026-11-05T19:00:00Z", note: "paused" } };
      }
      return { data: [] };
    };
    const result = await officePauseJob("j1", "a", "owner-1");
    expect(result).toEqual({});
    expect(h.pause).toHaveBeenCalledWith("j1", "a");
    expect(audits()[0]).toMatchObject({
      action: "pause",
      row_id: "e1",
      edited_by: "owner-1",
      before: { ended_at: null },
      after: { ended_at: "2026-11-05T19:00:00Z", note: "paused" },
    });
  });

  it("resumes only while the tech is clocked in", async () => {
    setup({ table: "job_time_entries" });
    const result = await officeResumeJob("j1", "a", "owner-1");
    expect(result.error).toMatch(/not clocked in/);
    expect(h.start).not.toHaveBeenCalled();
  });

  it("will not stop another job's timer to resume this one", async () => {
    h.openShift = { id: "s1", started_at: "2026-11-05T12:00:00Z" };
    h.handler = (call) => {
      if (call.table === "jobs") return { data: { id: "j1", status: "in_progress" } };
      if (call.end === "maybeSingle") return { data: { job_id: "j2", kind: "work" } };
      return { data: [] };
    };
    const result = await officeResumeJob("j1", "a", "owner-1");
    expect(result.error).toMatch(/another job/);
    expect(h.start).not.toHaveBeenCalled();
  });

  it("resumes through the truck helper and logs the new timer", async () => {
    h.openShift = { id: "s1", started_at: "2026-11-05T12:00:00Z" };
    const resumed = { ...entryRow, id: "e5", ended_at: null };
    let entryReads = 0;
    h.handler = (call) => {
      if (call.table === "time_edits") return {};
      if (call.table === "jobs") return { data: { id: "j1", status: "in_progress" } };
      if (call.end === "maybeSingle") {
        entryReads += 1;
        return { data: entryReads === 1 ? null : resumed };
      }
      return { data: [] };
    };
    const result = await officeResumeJob("j1", "a", "owner-1");
    expect(result).toEqual({});
    expect(h.start).toHaveBeenCalledWith("j1", "a", "work");
    expect(audits()[0]).toMatchObject({ action: "resume", row_id: "e5", before: null, edited_by: "owner-1" });
  });
});
