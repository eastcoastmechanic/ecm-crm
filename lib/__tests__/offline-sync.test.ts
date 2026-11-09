import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Call, Handler } from "./fake-supabase";

const h = vi.hoisted(() => ({
  handler: (() => ({})) as Handler,
  calls: [] as Call[],
  access: { role: "tech" } as { role?: string; error?: string },
  stepAccess: { role: "tech" } as { role?: string; error?: string },
  blockers: [] as string[],
  applyJobStatus: vi.fn(),
  startJobEntry: vi.fn(),
  onWayNotice: vi.fn(),
  oneNote: vi.fn(),
}));

vi.mock("next/server", () => ({ after: (fn: () => unknown) => fn() }));
vi.mock("@/lib/supabase", async () => {
  const { fakeSupabase } = await import("./fake-supabase");
  const fake = fakeSupabase((call) => {
    h.calls.push(call);
    return h.handler(call);
  });
  return { supabase: fake.client };
});
vi.mock("@/lib/job-access", () => ({
  checkJobAccess: (_id: string, opts: { nextStatus?: string }) => Promise.resolve(opts?.nextStatus ? h.stepAccess : h.access),
  getMyStaffId: () => Promise.resolve("staff-1"),
}));
vi.mock("@/lib/job-lifecycle", () => ({ applyJobStatus: (...a: unknown[]) => h.applyJobStatus(...a) }));
vi.mock("@/lib/job-checklist", () => ({ getFinishBlockers: () => Promise.resolve(h.blockers) }));
vi.mock("@/lib/time-clock", () => ({ startJobEntry: (...a: unknown[]) => (h.startJobEntry(...a), Promise.resolve({})) }));
vi.mock("@/lib/on-way-notice", () => ({ sendOnWayNotice: (...a: unknown[]) => (h.onWayNotice(...a), Promise.resolve()) }));
vi.mock("@/lib/onenote-sync", () => ({ syncJobNotesToOneNote: (...a: unknown[]) => (h.oneNote(...a), Promise.resolve()) }));

import { applyOfflineAction } from "../offline-sync";
import { has, payload } from "./fake-supabase";
import type { SyncRequest } from "../offline-sync-rules";

const JOB = "66666666-7777-4888-9999-000000000000";
const ACTION = "11111111-2222-4333-8444-555555555555";
const NOW = new Date("2026-11-09T18:00:00.000Z");
const TAP = "2026-11-09T16:00:00.000Z";

function req(type: SyncRequest["type"], extra: Partial<SyncRequest> = {}): SyncRequest {
  return { clientActionId: ACTION, type, jobId: JOB, createdAt: TAP, ...extra };
}

type Tables = {
  job?: Record<string, unknown> | null;
  noteInsert?: (row: Record<string, unknown>) => { error?: { message: string; code?: string } | null };
  existingNote?: boolean;
  onWayClaimed?: boolean;
};

function db(t: Tables) {
  h.handler = (call) => {
    if (call.table === "jobs") {
      if (payload(call, "update")) return { data: t.onWayClaimed === false ? [] : [{ id: JOB }] };
      return { data: t.job === undefined ? { status: "scheduled", on_way_at: null, arrived_at: null, completed_at: null } : t.job };
    }
    if (call.table === "staff") return { data: { name: "Mike" } };
    if (call.table === "job_notes") {
      const insert = payload(call, "insert");
      if (insert) return t.noteInsert ? t.noteInsert(insert) : {};
      return { data: t.existingNote ? [{ id: "n1" }] : [] };
    }
    return {};
  };
}

beforeEach(() => {
  h.calls = [];
  h.access = { role: "tech" };
  h.stepAccess = { role: "tech" };
  h.blockers = [];
  for (const fn of [h.applyJobStatus, h.startJobEntry, h.onWayNotice, h.oneNote]) fn.mockReset();
  h.applyJobStatus.mockResolvedValue({ changed: true });
});

describe("job notes from the phone", () => {
  it("saves with the phone's id and the tap time", async () => {
    db({});
    expect(await applyOfflineAction(req("note", { body: "Filter changed" }), NOW)).toEqual({ ok: true });
    const insert = h.calls.map((c) => payload(c, "insert")).find(Boolean);
    expect(insert).toMatchObject({ job_id: JOB, body: "Filter changed", client_action_id: ACTION, created_at: TAP, author_name: "Mike" });
    expect(h.oneNote).toHaveBeenCalledWith(JOB);
  });

  it("a retry of a note that already landed is 'already done', not a second note", async () => {
    db({ noteInsert: () => ({ error: { message: "duplicate key value", code: "23505" } }) });
    expect(await applyOfflineAction(req("note", { body: "Filter changed" }), NOW)).toEqual({ ok: true, already: true });
    expect(h.calls.filter((c) => payload(c, "insert"))).toHaveLength(1);
    expect(h.oneNote).not.toHaveBeenCalled();
  });

  it("before SQL 0076: same job, text and time is the same note", async () => {
    db({
      noteInsert: (row) => ("client_action_id" in row ? { error: { message: "column client_action_id does not exist", code: "42703" } } : {}),
      existingNote: true,
    });
    expect(await applyOfflineAction(req("note", { body: "Filter changed" }), NOW)).toEqual({ ok: true, already: true });
    expect(h.calls.filter((c) => payload(c, "insert"))).toHaveLength(1);
  });

  it("before SQL 0076: a new note still saves, without the id", async () => {
    db({
      noteInsert: (row) => ("client_action_id" in row ? { error: { message: "column client_action_id does not exist", code: "42703" } } : {}),
      existingNote: false,
    });
    expect(await applyOfflineAction(req("note", { body: "Filter changed" }), NOW)).toEqual({ ok: true });
    const inserts = h.calls.map((c) => payload(c, "insert")).filter(Boolean);
    expect(inserts).toHaveLength(2);
    expect(inserts[1]).not.toHaveProperty("client_action_id");
  });

  it("a database hiccup is retried later, not refused", async () => {
    db({ noteInsert: () => ({ error: { message: "connection reset", code: "08006" } }) });
    expect(await applyOfflineAction(req("note", { body: "x" }), NOW)).toMatchObject({ ok: false, retry: true });
  });
});

describe("steps from the phone", () => {
  it("someone else's job is refused with the plain reason", async () => {
    db({});
    h.access = { error: "This job is assigned to someone else" };
    expect(await applyOfflineAction(req("arrive"), NOW)).toEqual({ ok: false, error: "This job is assigned to someone else" });
    expect(h.applyJobStatus).not.toHaveBeenCalled();
  });

  it("I'm here uses the tap time and starts the work timer", async () => {
    db({ job: { status: "scheduled", on_way_at: "2026-11-09T15:30:00.000Z", arrived_at: null } });
    expect(await applyOfflineAction(req("arrive"), NOW)).toEqual({ ok: true });
    expect(h.applyJobStatus).toHaveBeenCalledWith(JOB, "in_progress", { at: TAP });
    expect(h.startJobEntry).toHaveBeenCalledWith(JOB, "staff-1", "work");
    // The timer it opened at sync time moves back to the tap.
    const moved = h.calls.find((c) => c.table === "job_time_entries" && payload(c, "update")?.started_at === TAP);
    expect(moved).toBeTruthy();
    // Any timer that start closed (drive leg, or the previous job) ends at the tap, on any job.
    const closed = h.calls.find((c) => c.table === "job_time_entries" && payload(c, "update")?.ended_at === TAP);
    expect(closed && has(closed, "eq", "staff_id", "staff-1")).toBe(true);
    expect(closed && has(closed, "eq", "job_id")).toBe(false);
  });

  it("On my way more than a day late: no customer notice", async () => {
    db({});
    await applyOfflineAction(req("on_way", { createdAt: "2026-11-07T17:55:00.000Z" }), NOW);
    expect(h.onWayNotice).not.toHaveBeenCalled();
  });

  it("I'm here sent twice: the second is already done and starts nothing", async () => {
    db({ job: { status: "in_progress", on_way_at: null, arrived_at: TAP } });
    expect(await applyOfflineAction(req("arrive"), NOW)).toEqual({ ok: true, already: true });
    expect(h.applyJobStatus).not.toHaveBeenCalled();
    expect(h.startJobEntry).not.toHaveBeenCalled();
  });

  it("lost race in the lifecycle (someone else moved it) counts as already done", async () => {
    db({ job: { status: "scheduled", on_way_at: null, arrived_at: null } });
    h.applyJobStatus.mockResolvedValue({ changed: false });
    expect(await applyOfflineAction(req("arrive"), NOW)).toEqual({ ok: true, already: true });
    expect(h.startJobEntry).not.toHaveBeenCalled();
  });

  it("Finish is refused while the checklist blocks it, and the reason comes back", async () => {
    db({ job: { status: "in_progress", on_way_at: null, arrived_at: "2026-11-09T15:00:00.000Z" } });
    h.blockers = ["Tick: Filter changed."];
    expect(await applyOfflineAction(req("finish"), NOW)).toEqual({ ok: false, error: "Tick: Filter changed." });
    expect(h.applyJobStatus).not.toHaveBeenCalled();
  });

  it("the owner is not held by the checklist", async () => {
    db({ job: { status: "in_progress", on_way_at: null, arrived_at: "2026-11-09T15:00:00.000Z" } });
    h.access = { role: "owner" };
    h.stepAccess = { role: "owner" };
    h.blockers = ["Tick: Filter changed."];
    expect(await applyOfflineAction(req("finish"), NOW)).toEqual({ ok: true });
  });

  it("Finish uses the tap time, but never before arrival", async () => {
    db({ job: { status: "in_progress", on_way_at: null, arrived_at: "2026-11-09T17:00:00.000Z" } });
    await applyOfflineAction(req("finish"), NOW);
    expect(h.applyJobStatus).toHaveBeenCalledWith(JOB, "complete", { at: "2026-11-09T17:00:00.000Z" });
  });

  it("Finish on a job already finished is already done; on a cancelled job it is refused", async () => {
    db({ job: { status: "complete", on_way_at: null, arrived_at: null } });
    expect(await applyOfflineAction(req("finish"), NOW)).toEqual({ ok: true, already: true });
    db({ job: { status: "cancelled", on_way_at: null, arrived_at: null } });
    expect(await applyOfflineAction(req("finish"), NOW)).toEqual({ ok: false, error: "This job was cancelled." });
  });

  it("On my way stamps only an empty on_way_at, and a late tap sends no customer notice", async () => {
    db({});
    expect(await applyOfflineAction(req("on_way"), NOW)).toEqual({ ok: true });
    const update = h.calls.find((c) => c.table === "jobs" && payload(c, "update"));
    expect(payload(update!, "update")).toEqual({ on_way_at: TAP });
    expect(has(update!, "is", "on_way_at", null)).toBe(true);
    // Tapped two hours before it reached us: the customer isn't told "on the way" now.
    expect(h.onWayNotice).not.toHaveBeenCalled();
    expect(h.startJobEntry).toHaveBeenCalledWith(JOB, "staff-1", "drive");
  });

  it("On my way that reaches us quickly tells the customer", async () => {
    db({});
    await applyOfflineAction(req("on_way", { createdAt: "2026-11-09T17:55:00.000Z" }), NOW);
    expect(h.onWayNotice).toHaveBeenCalledWith(JOB);
  });

  it("On my way sent twice: the second claims nothing and sends nothing", async () => {
    db({ onWayClaimed: false });
    expect(await applyOfflineAction(req("on_way", { createdAt: "2026-11-09T17:55:00.000Z" }), NOW)).toEqual({ ok: true, already: true });
    expect(h.onWayNotice).not.toHaveBeenCalled();
    expect(h.startJobEntry).not.toHaveBeenCalled();
  });
});
