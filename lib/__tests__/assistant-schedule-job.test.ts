import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Call, Handler } from "./fake-supabase";

// The assistant's schedule_job saves the job as requested and moves it to
// scheduled through job-lifecycle, like the office setting a time. That one
// status change sends the customer's schedule notice and syncs Graph/Planner.

const h = vi.hoisted(() => ({
  handler: (() => ({})) as Handler,
  calls: [] as Call[],
  applyJobStatus: vi.fn(),
  applyError: null as Error | null,
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
  applyJobStatus: (...a: unknown[]) => {
    h.applyJobStatus(...a);
    return h.applyError ? Promise.reject(h.applyError) : Promise.resolve({ changed: true });
  },
}));
vi.mock("@/app/(internal)/jobs/actions", () => ({ updateJobStatus: vi.fn(), rescheduleJobAt: vi.fn() }));
vi.mock("@/app/(internal)/leads/actions", () => ({
  setLeadStage: vi.fn(),
  addManualLead: vi.fn(),
  dismissLead: vi.fn(),
  deleteLead: vi.fn(),
}));
vi.mock("@/app/(internal)/inventory/actions", () => ({ adjustInventoryQty: vi.fn() }));
vi.mock("@/app/(internal)/documents/[id]/actions", () => ({ sendDocumentEmail: vi.fn() }));
vi.mock("@/lib/job-photos", () => ({
  appendJobPhotos: vi.fn(),
  uploadJobPhotoFiles: vi.fn(),
  jobPhotoPhases: vi.fn(),
  JOB_PHOTO_PHASES: ["arrival", "completion"],
}));
vi.mock("@/lib/planner-connector", () => ({ listOpenPlannerTasks: vi.fn() }));

import { opsTools } from "../internal-assistant/tools-ops";
import { payload } from "./fake-supabase";

type Tool = { name: string; run: (args: Record<string, unknown>) => Promise<unknown> };
const scheduleJob = () => (opsTools as unknown as Tool[]).find((t) => t.name === "schedule_job")!;
const inserted = () => h.calls.map((c) => payload(c, "insert")).find(Boolean);

beforeEach(() => {
  h.calls = [];
  h.applyError = null;
  h.applyJobStatus.mockReset();
  h.handler = (call) => (call.table === "jobs" && payload(call, "insert") ? { data: { id: "new-job" } } : {});
});

describe("assistant schedule_job", () => {
  it("saves the job as requested, then moves it to scheduled through the lifecycle once", async () => {
    const reply = String(await scheduleJob().run({ customerId: "c1", propertyId: "p1", scheduledAt: "2026-11-12T09:00:00-05:00" }));
    expect(inserted()).toMatchObject({ customer_id: "c1", property_id: "p1", status: "requested" });
    expect(h.applyJobStatus).toHaveBeenCalledTimes(1);
    expect(h.applyJobStatus).toHaveBeenCalledWith("new-job", "scheduled", { onlyFrom: "requested" });
    expect(reply).toMatch(/^Scheduled job new-job/);
  });

  it("a time with no zone is New York time, not the server's UTC", async () => {
    await scheduleJob().run({ customerId: "c1", scheduledAt: "2026-11-12T09:00" });
    // 9:00 AM EST is 14:00 UTC.
    expect(inserted()?.scheduled_at).toBe("2026-11-12T14:00:00.000Z");
  });

  it("refuses an unreadable time and saves nothing", async () => {
    const reply = String(await scheduleJob().run({ customerId: "c1", scheduledAt: "next tuesday" }));
    expect(reply).toMatch(/Couldn't read/);
    expect(inserted()).toBeUndefined();
    expect(h.applyJobStatus).not.toHaveBeenCalled();
  });

  it("says so when the status change fails after the job was saved", async () => {
    h.applyError = new Error("db down");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reply = String(await scheduleJob().run({ customerId: "c1", scheduledAt: "2026-11-12T09:00" }));
    expect(reply).toMatch(/couldn't mark it Scheduled/);
  });
});
