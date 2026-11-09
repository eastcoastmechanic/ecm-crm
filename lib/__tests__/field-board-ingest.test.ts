import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Call, Handler } from "./fake-supabase";

// A Field Board event only changes a job's status when the job is certain: an
// explicit job_id, or an external_ref this same source already tied to a job.
// A customer-name match in the text may attach the note, never the status.

const h = vi.hoisted(() => ({
  handler: (() => ({})) as Handler,
  calls: [] as Call[],
  applyJobStatus: vi.fn(),
}));

vi.mock("@/lib/supabase", async () => {
  const { fakeSupabase } = await import("./fake-supabase");
  const fake = fakeSupabase((call) => {
    h.calls.push(call);
    return h.handler(call);
  });
  return { supabase: fake.client };
});
vi.mock("@/lib/job-lifecycle", () => ({
  applyJobStatus: (...a: unknown[]) => (h.applyJobStatus(...a), Promise.resolve({ changed: true })),
}));
vi.mock("@/lib/planner-connector", () => ({ listOpenPlannerTasks: vi.fn(() => Promise.resolve([])) }));
vi.mock("@/lib/teams", () => ({ postToTeams: vi.fn(() => Promise.resolve()) }));

import { ingestFieldBoardEvent } from "../field-board";
import { has, payload } from "./fake-supabase";

const JOB = { id: "job-1", notes: null, status: "scheduled" };

type World = {
  jobIds?: string[];
  priorRef?: { source: string; ref: string; jobId: string };
  customers?: { id: string; name: string }[];
  customerJobs?: { id: string; status: string }[];
};

function world(w: World) {
  h.handler = (call) => {
    if (call.table === "field_board_events") {
      if (payload(call, "insert")) return { data: { id: "evt-1", job_id: payload(call, "insert")!.job_id } };
      // Duplicate check and the external_ref lookup both read here.
      const ref = call.ops.find(([m, col]) => m === "eq" && col === "external_ref")?.[2];
      const source = call.ops.find(([m, col]) => m === "eq" && col === "source")?.[2];
      const isDuplicateCheck = has(call, "select", "id, job_id");
      if (isDuplicateCheck) return { data: null };
      const p = w.priorRef;
      if (p && ref === p.ref && (source === undefined || source === p.source)) return { data: { job_id: p.jobId } };
      return { data: null };
    }
    if (call.table === "customers") return { data: w.customers ?? [] };
    if (call.table === "jobs") {
      if (payload(call, "update")) return {};
      if (has(call, "eq", "customer_id")) return { data: w.customerJobs ?? [] };
      const id = call.ops.find(([m, col]) => m === "eq" && col === "id")?.[2] as string;
      return { data: (w.jobIds ?? []).includes(id) ? { ...JOB, id } : null };
    }
    return {};
  };
}

const noteWritten = () => h.calls.some((c) => c.table === "jobs" && payload(c, "update")?.notes);

beforeEach(() => {
  h.calls = [];
  h.applyJobStatus.mockReset();
});

describe("ingestFieldBoardEvent status changes", () => {
  it("applies the status when the job_id is given", async () => {
    world({ jobIds: ["job-1"] });
    const result = await ingestFieldBoardEvent({ source: "quo", title: "On site", job_id: "job-1", crm_status: "in_progress" });
    expect(result.ok).toBe(true);
    expect(h.applyJobStatus).toHaveBeenCalledWith("job-1", "in_progress");
    expect(result).toMatchObject({ status_applied: true });
  });

  it("a single customer-name match attaches the note but never changes status", async () => {
    world({
      jobIds: ["job-1"],
      customers: [{ id: "c1", name: "Sullivan" }],
      customerJobs: [{ id: "job-1", status: "scheduled" }],
    });
    const result = await ingestFieldBoardEvent({ source: "quo", title: "Finished at Sullivan", crm_status: "complete" });
    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ job_id: "job-1", status_applied: false });
    expect(result).toHaveProperty("status_skipped");
    expect(noteWritten()).toBe(true);
    expect(h.applyJobStatus).not.toHaveBeenCalled();
  });

  it("an external_ref from the same source is certain enough to change status", async () => {
    world({ jobIds: ["job-1"], priorRef: { source: "quo", ref: "ref-9", jobId: "job-1" } });
    await ingestFieldBoardEvent({ source: "quo", title: "Done", external_ref: "ref-9", crm_status: "complete" });
    const lookup = h.calls.find((c) => c.table === "field_board_events" && has(c, "select", "job_id"));
    expect(lookup && has(lookup, "eq", "source", "quo")).toBe(true);
    expect(h.applyJobStatus).toHaveBeenCalledWith("job-1", "complete");
  });

  it("another source's external_ref is ignored", async () => {
    world({ jobIds: ["job-1"], priorRef: { source: "grok", ref: "ref-9", jobId: "job-1" } });
    const result = await ingestFieldBoardEvent({ source: "quo", title: "Done", external_ref: "ref-9", crm_status: "complete" });
    expect(result).toMatchObject({ job_id: null, status_applied: false });
    expect(h.applyJobStatus).not.toHaveBeenCalled();
  });

  it("a note with no status asked for has no status_skipped flag", async () => {
    world({ jobIds: ["job-1"] });
    const result = await ingestFieldBoardEvent({ source: "quo", title: "Waiting on part", job_id: "job-1" });
    expect(result).not.toHaveProperty("status_skipped");
    expect(h.applyJobStatus).not.toHaveBeenCalled();
  });
});
