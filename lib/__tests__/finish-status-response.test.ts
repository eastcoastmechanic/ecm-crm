import { beforeEach, describe, expect, it, vi } from "vitest";

// What a Finish sends back to the page: owner/office get the invoice to send, a tech gets nothing.

const PROMPT = { id: "inv1", docNumber: "INV-1001", totalCents: 500000, priced: true };

const h = vi.hoisted(() => ({
  role: "tech" as string,
  applyJobStatus: vi.fn(),
  getInvoicePrompt: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/lib/on-way-notice", () => ({ sendOnWayNotice: vi.fn() }));
vi.mock("@/lib/job-photos", () => ({ appendJobPhotos: vi.fn(), uploadJobPhotoFiles: vi.fn(), JOB_PHOTO_PHASES: [] }));
vi.mock("@/lib/graph-connector", () => ({ syncJobToGraph: vi.fn() }));
vi.mock("@/lib/planner-connector", () => ({ syncJobToPlanner: vi.fn() }));
vi.mock("@/lib/job-lifecycle", () => ({
  applyJobStatus: (...a: unknown[]) => (h.applyJobStatus(...a), Promise.resolve({ changed: true })),
  sendScheduleNotifications: vi.fn(),
}));
vi.mock("@/lib/require-role", () => ({ requireOffice: vi.fn(), requireRole: vi.fn() }));
vi.mock("@/lib/tech-notice-send", () => ({ notifyTech: vi.fn() }));
vi.mock("@/lib/job-access", () => ({
  getMyStaffId: () => Promise.resolve("s1"),
  requireJobAccess: () => Promise.resolve(h.role),
}));
vi.mock("@/lib/job-checklist", () => ({ getFinishBlockers: () => Promise.resolve([]) }));
vi.mock("@/lib/finish-invoice", () => ({
  getInvoicePrompt: (...a: unknown[]) => (h.getInvoicePrompt(...a), Promise.resolve(PROMPT)),
}));

import { updateJobStatus } from "@/app/(internal)/jobs/actions";

function finish(status = "complete") {
  const f = new FormData();
  f.set("id", "j1");
  f.set("status", status);
  return f;
}

beforeEach(() => {
  h.applyJobStatus.mockClear();
  h.getInvoicePrompt.mockClear();
});

describe("updateJobStatus after Finish", () => {
  it("a tech's response carries no invoice and no money fields", async () => {
    h.role = "tech";
    const res = await updateJobStatus(finish());
    expect(res).toEqual({});
    expect(JSON.stringify(res)).not.toMatch(/invoice|total|cents|\$/i);
    expect(h.getInvoicePrompt).not.toHaveBeenCalled();
    expect(h.applyJobStatus).toHaveBeenCalledWith("j1", "complete");
  });

  it("owner and office get the Send now prompt", async () => {
    for (const role of ["owner", "office"]) {
      h.role = role;
      expect(await updateJobStatus(finish())).toEqual({ invoicePrompt: PROMPT });
    }
  });

  it("other status changes never look at the invoice", async () => {
    h.role = "owner";
    expect(await updateJobStatus(finish("in_progress"))).toEqual({});
    expect(h.getInvoicePrompt).not.toHaveBeenCalled();
  });
});
