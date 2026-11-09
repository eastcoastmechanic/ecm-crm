import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Call, Handler } from "./fake-supabase";

// Giving a "requested" job a time from the office (dispatch, jobs list, route
// optimizer, assistant) makes it "scheduled" through the lifecycle, so the
// day-before reminder picks it up. The customer gets one schedule notice.

const h = vi.hoisted(() => ({
  handler: (() => ({})) as Handler,
  calls: [] as Call[],
  applyJobStatus: vi.fn(),
  sendScheduleNotifications: vi.fn(),
  syncJobToGraph: vi.fn(),
  notifyTech: vi.fn(),
  applyResult: { changed: true } as { changed: boolean } | Error,
}));

vi.mock("@/lib/supabase", async () => {
  const { fakeSupabase } = await import("./fake-supabase");
  const fake = fakeSupabase((call) => {
    h.calls.push(call);
    return h.handler(call);
  });
  return { supabase: fake.client };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("NEXT_REDIRECT"); } }));
vi.mock("@/lib/require-role", () => ({ requireOffice: () => Promise.resolve(), requireRole: () => Promise.resolve("office") }));
vi.mock("@/lib/job-access", () => ({ getMyStaffId: () => Promise.resolve(null), requireJobAccess: () => Promise.resolve("office") }));
vi.mock("@/lib/job-checklist", () => ({ getFinishBlockers: () => Promise.resolve([]) }));
vi.mock("@/lib/job-photos", () => ({ appendJobPhotos: vi.fn(), uploadJobPhotoFiles: vi.fn(), JOB_PHOTO_PHASES: [] }));
vi.mock("@/lib/resend", () => ({ resend: { emails: { send: vi.fn() } }, RESEND_FROM_EMAIL: "x", RESEND_REPLY_TO: "y" }));
vi.mock("@/lib/sms", () => ({ sendSMS: vi.fn() }));
vi.mock("@/lib/sms-consent", () => ({ canText: vi.fn() }));
vi.mock("@/lib/graph-connector", () => ({ syncJobToGraph: (...a: unknown[]) => h.syncJobToGraph(...a) }));
vi.mock("@/lib/planner-connector", () => ({ syncJobToPlanner: vi.fn(), noteJobStep: vi.fn() }));
vi.mock("@/lib/tech-notice-send", () => ({ notifyTech: (...a: unknown[]) => h.notifyTech(...a) }));
vi.mock("@/lib/job-lifecycle", () => ({
  applyJobStatus: (...a: unknown[]) => {
    h.applyJobStatus(...a);
    return h.applyResult instanceof Error ? Promise.reject(h.applyResult) : Promise.resolve(h.applyResult);
  },
  sendScheduleNotifications: (...a: unknown[]) => h.sendScheduleNotifications(...a),
}));

import { rescheduleJob, rescheduleJobAt } from "@/app/(internal)/jobs/actions";
import { payload } from "./fake-supabase";

function jobIs(status: string, scheduledAt: string | null = null) {
  h.handler = (call) => {
    if (call.table === "jobs" && !payload(call, "update")) return { data: { id: "j1", status, scheduled_at: scheduledAt, assigned_staff_id: null } };
    return {};
  };
}

const savedTime = () => h.calls.find((c) => c.table === "jobs" && payload(c, "update"))?.ops.find(([m]) => m === "update")?.[1];

beforeEach(() => {
  h.calls = [];
  h.applyResult = { changed: true };
  for (const fn of [h.applyJobStatus, h.sendScheduleNotifications, h.syncJobToGraph, h.notifyTech]) fn.mockReset();
});

describe("rescheduleJobAt (dispatch, route optimizer, assistant)", () => {
  it("a requested job given a time becomes scheduled, with one notice from the status change", async () => {
    jobIs("requested");
    expect(await rescheduleJobAt("j1", "2026-11-12T09:00")).toEqual({});
    expect(savedTime()).toEqual({ scheduled_at: "2026-11-12T14:00:00.000Z" });
    expect(h.applyJobStatus).toHaveBeenCalledWith("j1", "scheduled", { onlyFrom: "requested" });
    // The status change sends the notice and syncs Graph, so neither runs a second time here.
    expect(h.sendScheduleNotifications).not.toHaveBeenCalled();
    expect(h.syncJobToGraph).not.toHaveBeenCalled();
  });

  it("an already scheduled job keeps its status and gets the usual notice", async () => {
    jobIs("scheduled", "2026-11-11T14:00:00.000Z");
    expect(await rescheduleJobAt("j1", "2026-11-12T09:00")).toEqual({});
    expect(h.applyJobStatus).not.toHaveBeenCalled();
    expect(h.sendScheduleNotifications).toHaveBeenCalledTimes(1);
    expect(h.syncJobToGraph).toHaveBeenCalledTimes(1);
  });

  it("if someone else changed the status first, still sends the notice for the new time", async () => {
    jobIs("requested");
    h.applyResult = { changed: false };
    expect(await rescheduleJobAt("j1", "2026-11-12T09:00")).toEqual({});
    expect(h.sendScheduleNotifications).toHaveBeenCalledTimes(1);
  });

  it("returns an error (not a throw) when the status change fails, time still saved", async () => {
    jobIs("requested");
    h.applyResult = new Error("db down");
    const result = await rescheduleJobAt("j1", "2026-11-12T09:00");
    expect(result.error).toMatch(/couldn't mark the job Scheduled/);
    expect(savedTime()).toEqual({ scheduled_at: "2026-11-12T14:00:00.000Z" });
  });
});

describe("rescheduleJob (jobs list date box)", () => {
  it("a requested job moved to a day becomes scheduled at 9 AM New York time", async () => {
    jobIs("requested");
    expect(await rescheduleJob("j1", "2026-11-12")).toEqual({});
    expect(savedTime()).toEqual({ scheduled_at: "2026-11-12T14:00:00.000Z" });
    expect(h.applyJobStatus).toHaveBeenCalledWith("j1", "scheduled", { onlyFrom: "requested" });
    expect(h.sendScheduleNotifications).not.toHaveBeenCalled();
  });

  it("an in-progress job keeps its status", async () => {
    jobIs("in_progress", "2026-11-11T19:00:00.000Z");
    expect(await rescheduleJob("j1", "2026-11-12")).toEqual({});
    expect(savedTime()).toEqual({ scheduled_at: "2026-11-12T19:00:00.000Z" });
    expect(h.applyJobStatus).not.toHaveBeenCalled();
    expect(h.sendScheduleNotifications).toHaveBeenCalledTimes(1);
  });
});
