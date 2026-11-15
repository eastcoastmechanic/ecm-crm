import { describe, expect, it } from "vitest";
import { buildJobLogText, clockedWorkHours, jobLogFileName, jobTypeLabel, type JobLogInput } from "@/lib/job-log-rules";

const JOB_ID = "1a2b3c4d-5e6f-7a8b-9c0d-112233445566";

function input(over: Partial<JobLogInput> = {}): JobLogInput {
  return {
    job: {
      id: JOB_ID,
      job_type: "service",
      status: "complete",
      created_at: "2026-11-12T14:00:00Z",
      scheduled_at: "2026-11-13T14:00:00Z",
      on_way_at: "2026-11-13T13:40:00Z",
      arrived_at: "2026-11-13T14:05:00Z",
      completed_at: "2026-11-13T16:20:00Z",
      notes: "No heat upstairs",
      created_via: "manual",
    },
    customerName: "Test Customer",
    address: "1 Test St Plymouth",
    assignedTech: "Tech One",
    linkedDoc: null,
    timeEntries: [
      { staff: "Tech One", kind: "drive", started_at: "2026-11-13T13:40:00Z", ended_at: "2026-11-13T14:05:00Z", note: null },
      { staff: "Tech One", kind: "work", started_at: "2026-11-13T14:05:00Z", ended_at: "2026-11-13T15:05:00Z", note: "paused" },
      { staff: "Tech One", kind: "work", started_at: "2026-11-13T15:20:00Z", ended_at: "2026-11-13T16:20:00Z", note: null },
      { staff: "Tech One", kind: "work", started_at: "2026-11-13T10:00:00Z", ended_at: "2026-11-13T12:00:00Z", note: null, voided_at: "2026-11-13T18:00:00Z" },
    ],
    notes: [{ author_name: "Tech One", body: "Replaced igniter\nTested two cycles", created_at: "2026-11-13T16:00:00Z" }],
    photos: [{ phase: "arrival", caption: null, taken_at: "2026-11-13T14:06:00Z", link: "https://sp.example/photo1" }],
    receipts: [
      { vendor: "Supply House", purchased_on: "2026-11-13", note: "igniter", uploaded_by_name: "Tech One", created_at: "2026-11-13T15:10:00Z", link: null },
    ],
    invoices: [{ doc_number: "INV-1001", status: "sent", created_at: "2026-11-13T16:21:00Z", sent_at: "2026-11-13T17:00:00Z", paid_at: null }],
    reports: [{ doc_number: "RPT-1004", created_at: "2026-11-13T14:10:00Z" }],
    builtAt: new Date("2026-11-13T18:00:00Z"),
    ...over,
  };
}

describe("jobLogFileName", () => {
  it("uses the New York day the job was made, its type and short id, so rebuilds replace the same file", () => {
    expect(jobLogFileName({ id: JOB_ID, job_type: "service", created_at: "2026-11-13T03:00:00Z" })).toBe(
      "2026-11-12 Service 1a2b3c4d - Job log.txt"
    );
    expect(jobLogFileName({ id: JOB_ID, job_type: null, created_at: null })).toBe("undated Job 1a2b3c4d - Job log.txt");
  });
  it("labels odd job types readably", () => {
    expect(jobTypeLabel("service_call")).toBe("Service call");
    expect(jobTypeLabel("install")).toBe("Install");
  });
});

describe("clockedWorkHours", () => {
  it("adds closed work timers only, skipping drive time, open and voided timers", () => {
    expect(clockedWorkHours(input().timeEntries)).toBe(2);
    expect(clockedWorkHours([{ staff: null, kind: "work", started_at: "2026-11-13T14:00:00Z", ended_at: null, note: null }])).toBe(0);
  });
});

describe("buildJobLogText", () => {
  const text = buildJobLogText(input());

  it("has the header facts", () => {
    expect(text).toContain("JOB LOG - Service job 1a2b3c4d");
    expect(text).toContain("Address:    1 Test St Plymouth");
    expect(text).toContain("Status:     Done");
    expect(text).toContain("Tech:       Tech One");
    expect(text).toContain("Clocked work: 2 h");
    expect(text).toContain("Invoices:   INV-1001 sent");
    expect(text).toContain("No heat upstairs");
  });

  it("lists what happened in time order, in New York time", () => {
    const order = [
      "Job created (manual)",
      "On my way",
      "Arrived on site",
      "Photo added (arrival): https://sp.example/photo1",
      "Service report RPT-1004 started",
      "Tech One paused work",
      "Receipt from Supply House (dated 2026-11-13, igniter, added by Tech One)",
      "Note from Tech One:",
      "Job done",
      "Invoice INV-1001 created",
      "Invoice INV-1001 sent to the customer",
    ].map((s) => text.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).toContain("Fri, Nov 13, 2026, 9:05 AM  Arrived on site");
  });

  it("skips voided timers and indents multi-line notes", () => {
    expect(text).not.toContain("5:00 AM");
    expect(text).toContain("Replaced igniter\r\n    Tested two cycles");
  });

  it("never prints a money amount", () => {
    expect(text).not.toMatch(/\$\s?\d/);
  });

  it("says when nothing has happened and that edits get overwritten", () => {
    const empty = buildJobLogText(
      input({
        job: { ...input().job, created_at: null, on_way_at: null, arrived_at: null, completed_at: null, status: "requested", scheduled_at: null },
        timeEntries: [],
        notes: [],
        photos: [],
        receipts: [],
        invoices: [],
        reports: [],
      })
    );
    expect(empty).toContain("Nothing logged yet.");
    expect(empty).toContain("Scheduled:  Not scheduled");
    expect(empty).toContain("edits made here are lost");
  });
});
