import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Call, Handler } from "./fake-supabase";

// The phone/text receptionist books requests and moves jobs, both pending the
// office. It must not move a finished, cancelled or under-way job, and it tells
// the owner (and the assigned tech, for a move) so nothing sits unseen.

const h = vi.hoisted(() => ({
  handler: (() => ({})) as Handler,
  calls: [] as Call[],
  applyJobStatus: vi.fn(),
  notifyOwner: vi.fn(),
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
vi.mock("@/lib/customer-intake", () => ({
  resolveCustomerPropertyEquipment: () => Promise.resolve({ customerId: "c1", propertyId: "p1" }),
}));
vi.mock("@/lib/job-lifecycle", () => ({
  applyJobStatus: (...a: unknown[]) => (h.applyJobStatus(...a), Promise.resolve({ changed: true })),
}));
vi.mock("@/lib/notify-owner", () => ({ notifyOwnerOfReceptionistRequest: (...a: unknown[]) => h.notifyOwner(...a) }));
vi.mock("@/lib/tech-notice-send", () => ({ notifyTech: (...a: unknown[]) => h.notifyTech(...a) }));

import { buildReceptionistTools } from "../receptionist/tools";
import { has, payload } from "./fake-supabase";

type Tool = { name: string; run: (args: Record<string, unknown>) => Promise<unknown> };
function tool(name: string, createdVia = "ai_voice") {
  const tools = buildReceptionistTools({ customerId: "c1", phoneNumber: "+15555550100", createdVia }) as unknown as Tool[];
  return tools.find((t) => t.name === name)!;
}

function jobIs(status: string) {
  h.handler = (call) => {
    if (call.table !== "jobs") return {};
    if (payload(call, "insert")) return { data: { id: "new-job" } };
    if (payload(call, "update")) {
      // The move only lands while the job is still open.
      return { data: ["requested", "scheduled"].includes(status) ? [{ id: "j1" }] : [] };
    }
    return {
      data: { id: "j1", customer_id: "c1", status, scheduled_at: "2026-11-11T14:00:00.000Z", assigned_staff_id: "tech-1" },
    };
  };
}

const moveSaved = () => h.calls.some((c) => c.table === "jobs" && payload(c, "update"));

beforeEach(() => {
  h.calls = [];
  for (const fn of [h.applyJobStatus, h.notifyOwner, h.notifyTech]) fn.mockReset();
});

describe("reschedule_job_request", () => {
  for (const status of ["complete", "completed", "cancelled", "in_progress"]) {
    it(`refuses a ${status} job and changes nothing`, async () => {
      jobIs(status);
      const reply = await tool("reschedule_job_request").run({ jobId: "j1", newDate: "2026-11-12", newTime: "10:00" });
      expect(String(reply)).toMatch(/can't be moved/);
      expect(moveSaved()).toBe(false);
      expect(h.applyJobStatus).not.toHaveBeenCalled();
      expect(h.notifyOwner).not.toHaveBeenCalled();
    });
  }

  it("moves an open job, sets it back to requested through the lifecycle, alerts owner and tech", async () => {
    jobIs("scheduled");
    const reply = await tool("reschedule_job_request").run({ jobId: "j1", newDate: "2026-11-12", newTime: "10:00" });
    expect(String(reply)).toMatch(/pending confirmation/);

    const update = h.calls.find((c) => c.table === "jobs" && payload(c, "update"))!;
    // 10:00 AM New York on Nov 12 is 15:00 UTC. The status is not written directly.
    expect(payload(update, "update")).toEqual({ scheduled_at: "2026-11-12T15:00:00.000Z", created_via: "ai_voice" });
    expect(has(update, "in", "status")).toBe(true);
    expect(h.applyJobStatus).toHaveBeenCalledWith("j1", "requested", { onlyFrom: "scheduled" });
    expect(h.notifyOwner).toHaveBeenCalledWith({
      kind: "reschedule",
      jobId: "j1",
      channel: "ai_voice",
      previousAt: "2026-11-11T14:00:00.000Z",
    });
    expect(h.notifyTech).toHaveBeenCalledWith({ jobId: "j1", staffId: "tech-1", kind: "rescheduled" });
  });
});

describe("create_job_request", () => {
  it("alerts the owner about the new request", async () => {
    jobIs("requested");
    const reply = await tool("create_job_request", "ai_sms").run({
      date: "2026-11-12",
      time: "13:00",
      address: "1 Test St",
      description: "No heat",
    });
    expect(String(reply)).toMatch(/pending confirmation/);
    expect(h.notifyOwner).toHaveBeenCalledWith({ kind: "new", jobId: "new-job", channel: "ai_sms" });
  });
});
