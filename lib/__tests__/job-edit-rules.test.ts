import { describe, expect, it } from "vitest";
import {
  NEW_PROPERTY_VALUE,
  NOTES_MAX,
  jobTab,
  normalizeJobStatus,
  officeDoneGate,
  parseJobEdit,
  parseJobTab,
  splitJobsByTab,
  statusBeforeTime,
  type JobEditInput,
} from "../job-edit-rules";

const blank: JobEditInput = {
  customerId: null,
  originalCustomerId: null,
  propertyId: null,
  originalPropertyId: null,
  newAddress: null,
  jobType: null,
  originalJobType: null,
  notes: null,
  originalNotes: null,
  staffId: null,
  originalStaffId: null,
  scheduledAt: null,
  originalScheduledAt: null,
  status: null,
  originalStatus: null,
};

/** The full editor as shown for a job, nothing touched yet. */
const shown: JobEditInput = {
  customerId: "c1",
  originalCustomerId: "c1",
  propertyId: "p1",
  originalPropertyId: "p1",
  newAddress: null,
  jobType: "service",
  originalJobType: "service",
  notes: "Leaky valve",
  originalNotes: "Leaky valve",
  staffId: "",
  originalStaffId: "",
  scheduledAt: "2026-11-14T09:00",
  originalScheduledAt: "2026-11-14T09:00",
  status: "scheduled",
  originalStatus: "scheduled",
};

describe("job status spellings and tabs", () => {
  it("treats completed as complete and canceled as cancelled", () => {
    expect(normalizeJobStatus("completed")).toBe("complete");
    expect(normalizeJobStatus("canceled")).toBe("cancelled");
    expect(normalizeJobStatus(null)).toBe("");
  });

  it("puts both done spellings under Completed and open work under Active", () => {
    expect(jobTab("complete")).toBe("completed");
    expect(jobTab("completed")).toBe("completed");
    expect(jobTab("cancelled")).toBe("cancelled");
    expect(jobTab("canceled")).toBe("cancelled");
    for (const s of ["requested", "scheduled", "in_progress", null, ""]) expect(jobTab(s)).toBe("active");
  });

  it("reads the tab from the URL, defaulting to Active", () => {
    expect(parseJobTab("completed")).toBe("completed");
    expect(parseJobTab("cancelled")).toBe("cancelled");
    expect(parseJobTab("anything")).toBe("active");
    expect(parseJobTab(undefined)).toBe("active");
  });

  it("splits jobs, keeps active order, and lists finished newest first by finish time", () => {
    const jobs = [
      { id: "a", status: "scheduled", scheduled_at: "2026-11-20T14:00:00Z" },
      { id: "b", status: "complete", scheduled_at: "2026-11-01T14:00:00Z", completed_at: "2026-11-02T20:00:00Z" },
      { id: "c", status: "completed", scheduled_at: "2026-11-10T14:00:00Z", completed_at: null },
      { id: "d", status: "in_progress", scheduled_at: null },
      { id: "e", status: "cancelled", scheduled_at: "2026-11-05T14:00:00Z" },
      { id: "f", status: "complete", scheduled_at: null, completed_at: "2026-11-12T15:00:00Z" },
    ];
    const out = splitJobsByTab(jobs);
    expect(out.active.map((j) => j.id)).toEqual(["a", "d"]);
    expect(out.completed.map((j) => j.id)).toEqual(["f", "c", "b"]);
    expect(out.cancelled.map((j) => j.id)).toEqual(["e"]);
  });
});

describe("parseJobEdit", () => {
  it("saves nothing when nothing was touched", () => {
    expect(parseJobEdit(shown)).toEqual({ changes: {} });
    expect(parseJobEdit(blank)).toEqual({ changes: {} });
  });

  it("ignores whitespace-only differences", () => {
    expect(parseJobEdit({ ...shown, notes: "  Leaky valve  " })).toEqual({ changes: {} });
  });

  it("returns only the changed fields", () => {
    const out = parseJobEdit({ ...shown, notes: "Replaced valve", staffId: "s1", jobType: "repair" });
    expect(out).toEqual({ changes: { notes: "Replaced valve", staffId: "s1", jobType: "repair" } });
  });

  it("lets notes be cleared and the tech unassigned", () => {
    expect(parseJobEdit({ ...shown, notes: "", originalStaffId: "s1", staffId: "" })).toEqual({
      changes: { notes: "", staffId: "" },
    });
  });

  it("refuses notes that are too long and an unknown job type", () => {
    expect(parseJobEdit({ ...shown, notes: "x".repeat(NOTES_MAX + 1) })).toHaveProperty("error");
    expect(parseJobEdit({ ...shown, jobType: "demolition" })).toHaveProperty("error");
  });

  it("checks the time, and won't clear a time the job had", () => {
    expect(parseJobEdit({ ...shown, scheduledAt: "2026-11-15T13:30" })).toEqual({
      changes: { scheduledAt: "2026-11-15T13:30" },
    });
    expect(parseJobEdit({ ...shown, scheduledAt: "" })).toHaveProperty("error");
    expect(parseJobEdit({ ...shown, scheduledAt: "next tuesday" })).toHaveProperty("error");
  });

  it("normalizes the status and treats completed -> complete as no change", () => {
    expect(parseJobEdit({ ...shown, status: "complete" })).toEqual({ changes: { status: "complete" } });
    expect(parseJobEdit({ ...shown, originalStatus: "completed", status: "complete" })).toEqual({ changes: {} });
    expect(parseJobEdit({ ...shown, originalStatus: "completed", status: "scheduled" })).toEqual({
      changes: { status: "scheduled" },
    });
    expect(parseJobEdit({ ...shown, status: "on_hold" })).toHaveProperty("error");
  });

  it("needs the new customer's address when the customer changes", () => {
    expect(parseJobEdit({ ...shown, customerId: "c2" })).toHaveProperty("error");
    expect(parseJobEdit({ ...shown, customerId: "c2", propertyId: "p9" })).toEqual({
      changes: { customerId: "c2", propertyId: "p9" },
    });
    expect(parseJobEdit({ ...shown, customerId: "c2", propertyId: "" })).toEqual({
      changes: { customerId: "c2", propertyId: "" },
    });
    // No address before: changing the customer alone is fine.
    expect(parseJobEdit({ ...shown, originalPropertyId: "", propertyId: "", customerId: "c2" })).toEqual({
      changes: { customerId: "c2" },
    });
  });

  it("adds a new address only with text and a customer", () => {
    expect(parseJobEdit({ ...shown, propertyId: NEW_PROPERTY_VALUE, newAddress: "  12  Main St,  Plymouth " })).toEqual({
      changes: { newAddress: "12 Main St, Plymouth" },
    });
    expect(parseJobEdit({ ...shown, propertyId: NEW_PROPERTY_VALUE, newAddress: " " })).toHaveProperty("error");
    expect(
      parseJobEdit({ ...shown, customerId: "", propertyId: NEW_PROPERTY_VALUE, newAddress: "12 Main St" })
    ).toHaveProperty("error");
    expect(
      parseJobEdit({ ...shown, customerId: "c2", propertyId: NEW_PROPERTY_VALUE, newAddress: "12 Main St" })
    ).toEqual({ changes: { customerId: "c2", newAddress: "12 Main St" } });
  });
});

describe("officeDoneGate", () => {
  it("lets a job with nothing open through with nothing logged", () => {
    expect(officeDoneGate([], undefined)).toEqual({ ok: true, logReason: null });
  });

  it("asks why when the truck checklist or photo is not done", () => {
    const out = officeDoneGate(["Add at least one job photo."], "");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("Add at least one job photo.");
    expect(officeDoneGate(["x"], "ok").ok).toBe(false);
  });

  it("logs the reason when one is given", () => {
    expect(officeDoneGate(["x"], "  Tech's phone died  ")).toEqual({
      ok: true,
      logReason: "Marked done from Jobs: Tech's phone died",
    });
  });
});

describe("statusBeforeTime", () => {
  it("closes first only for done or cancelled", () => {
    expect(statusBeforeTime("complete")).toBe(true);
    expect(statusBeforeTime("cancelled")).toBe(true);
    expect(statusBeforeTime("scheduled")).toBe(false);
    expect(statusBeforeTime(undefined)).toBe(false);
  });
});
