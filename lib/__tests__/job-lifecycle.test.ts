import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Call, Handler } from "./fake-supabase";

const h = vi.hoisted(() => ({
  handler: (() => ({})) as Handler,
  calls: [] as Call[],
  emailSend: vi.fn(),
  notifyOwner: vi.fn(),
  finalize: vi.fn(),
  graph: vi.fn(),
  planner: vi.fn(),
  notifyTech: vi.fn(),
}));

vi.mock("@/lib/supabase", async () => {
  const { fakeSupabase } = await import("./fake-supabase");
  const fake = fakeSupabase((call) => {
    h.calls.push(call);
    return h.handler(call);
  });
  return { supabase: fake.client };
});
vi.mock("@/lib/resend", () => ({
  resend: { emails: { send: (...a: unknown[]) => (h.emailSend(...a), Promise.resolve({})) } },
  RESEND_FROM_EMAIL: "from@example.test",
  RESEND_REPLY_TO: "reply@example.test",
}));
vi.mock("@/lib/sms", () => ({ sendSMS: vi.fn(() => Promise.resolve({ ok: true })) }));
vi.mock("@/lib/sms-consent", () => ({ canText: vi.fn(() => Promise.resolve(false)) }));
vi.mock("@/lib/ics", () => ({ generateJobICS: () => "ICS" }));
vi.mock("@/lib/graph-connector", () => ({ syncJobToGraph: (...a: unknown[]) => h.graph(...a) }));
vi.mock("@/lib/planner-connector", () => ({ syncJobToPlanner: (...a: unknown[]) => h.planner(...a) }));
vi.mock("@/lib/notify-owner", () => ({ notifyOwnerOfEvent: (...a: unknown[]) => h.notifyOwner(...a) }));
vi.mock("@/lib/tech-notice-send", () => ({ notifyTech: (...a: unknown[]) => h.notifyTech(...a) }));
vi.mock("@/lib/time-clock", () => ({
  finalizeJobTime: (...a: unknown[]) => (h.finalize(...a), Promise.resolve(null)),
  closeJobEntries: vi.fn(),
}));

import { applyJobStatus } from "../job-lifecycle";
import { has, payload } from "./fake-supabase";

type JobRow = Record<string, unknown>;

/**
 * Jobs table that behaves like Postgres for the conditional update: the update
 * only matches while the row still has the status the caller read.
 */
function jobsTable(row: JobRow) {
  h.handler = (call) => {
    if (call.table !== "jobs") return {};
    const update = payload(call, "update");
    if (update && has(call, "select")) {
      const expected = call.ops.find(([m, col]) => m === "eq" && col === "status")?.[2];
      if (row.status !== expected) return { data: [] };
      Object.assign(row, update);
      return { data: [{ id: row.id }] };
    }
    if (update) {
      Object.assign(row, update);
      return {};
    }
    return { data: { ...row } };
  };
}

beforeEach(() => {
  h.calls = [];
  for (const fn of [h.emailSend, h.notifyOwner, h.finalize, h.graph, h.planner, h.notifyTech]) fn.mockReset();
  vi.stubEnv("OWNER_EMAIL", "");
});

describe("applyJobStatus", () => {
  it("two Finish taps at once: one alert, time finalized once", async () => {
    // Both taps read the job while it is still in progress, then both try to finish it.
    const row: JobRow = { id: "j1", status: "in_progress", completed_at: null, arrived_at: "2026-11-09T14:00:00.000Z", on_way_at: null };
    const snapshot = { ...row };
    let reads = 0;
    jobsTable(row);
    const base = h.handler;
    h.handler = (call) => {
      // The first two reads both see the job before either update lands.
      if (call.table === "jobs" && !payload(call, "update") && call.ops.some(([m, a]) => m === "select" && String(a).startsWith("status"))) {
        reads++;
        if (reads <= 2) return { data: { ...snapshot } };
      }
      return base(call);
    };

    const results = await Promise.all([applyJobStatus("j1", "complete"), applyJobStatus("j1", "complete")]);

    expect(results.map((r) => r.changed).sort()).toEqual([false, true]);
    expect(h.notifyOwner).toHaveBeenCalledTimes(1);
    expect(h.notifyOwner).toHaveBeenCalledWith("job_completed", "j1");
    expect(h.finalize).toHaveBeenCalledTimes(1);
    expect(h.planner).toHaveBeenCalledTimes(1);
    expect(row.status).toBe("complete");
  });

  it("a second Finish after the first landed does nothing", async () => {
    const row: JobRow = { id: "j1", status: "in_progress", completed_at: null, arrived_at: null, on_way_at: null };
    jobsTable(row);
    expect((await applyJobStatus("j1", "complete")).changed).toBe(true);
    expect((await applyJobStatus("j1", "complete")).changed).toBe(false);
    expect(h.notifyOwner).toHaveBeenCalledTimes(1);
    expect(h.finalize).toHaveBeenCalledTimes(1);
    expect(h.graph).toHaveBeenCalledTimes(1);
  });

  it("only updates where the status is still the one it read", async () => {
    const row: JobRow = { id: "j1", status: "scheduled", completed_at: null, arrived_at: null, on_way_at: null };
    jobsTable(row);
    await applyJobStatus("j1", "in_progress");
    const claim = h.calls.find((c) => c.table === "jobs" && payload(c, "update")?.status === "in_progress");
    expect(claim && has(claim, "eq", "status", "scheduled")).toBe(true);
    expect(row.arrived_at).toBeTruthy();
  });

  it("requested to scheduled sends the customer one schedule notice", async () => {
    const row: JobRow = {
      id: "j1",
      status: "requested",
      completed_at: null,
      arrived_at: null,
      on_way_at: null,
      scheduled_at: "2026-11-12T14:00:00.000Z",
      ics_sequence: 0,
      customers: { name: "Test Customer", email: "customer@example.test", phone: null, sms_consent: false },
      properties: { address: "1 Test St" },
    };
    jobsTable(row);
    expect((await applyJobStatus("j1", "scheduled")).changed).toBe(true);
    expect(await applyJobStatus("j1", "scheduled")).toEqual({ changed: false });
    const customerEmails = h.emailSend.mock.calls.filter(([msg]) => (msg as { to: string }).to === "customer@example.test");
    expect(customerEmails).toHaveLength(1);
    expect((customerEmails[0][0] as { text: string }).text).toContain("Thursday, November 12 at 9:00 AM");
  });

  it("onlyFrom leaves a job alone that moved on since the caller read it", async () => {
    // Office gave a requested job a time, but a tech finished it in between.
    const row: JobRow = { id: "j1", status: "complete", completed_at: "2026-11-09T15:00:00.000Z", arrived_at: null, on_way_at: null };
    jobsTable(row);
    expect(await applyJobStatus("j1", "scheduled", { onlyFrom: "requested" })).toEqual({ changed: false });
    expect(row.status).toBe("complete");
    expect(h.calls.some((c) => payload(c, "update"))).toBe(false);
    expect(h.planner).not.toHaveBeenCalled();
  });

  it("onlyFrom still moves a job in that status", async () => {
    const row: JobRow = { id: "j1", status: "requested", completed_at: null, arrived_at: null, on_way_at: null };
    jobsTable(row);
    expect(await applyJobStatus("j1", "scheduled", { onlyFrom: "requested" })).toEqual({ changed: true });
    expect(row.status).toBe("scheduled");
  });

  it("a job with no status yet is claimed with an is-null filter", async () => {
    const row: JobRow = { id: "j1", status: null, completed_at: null, arrived_at: null, on_way_at: null };
    h.handler = (call) => {
      if (payload(call, "update") && has(call, "select")) return { data: has(call, "is", "status", null) ? [{ id: "j1" }] : [] };
      return { data: { ...row } };
    };
    expect((await applyJobStatus("j1", "cancelled")).changed).toBe(true);
    expect(h.notifyTech).toHaveBeenCalledTimes(1);
  });
});
