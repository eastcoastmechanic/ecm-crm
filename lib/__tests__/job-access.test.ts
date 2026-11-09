import { describe, expect, it } from "vitest";
import { jobAccessError, jobAccessMessage } from "../job-access-rules";

const me = "staff-me";
const other = "staff-other";
const open = (assigned: string | null, status = "scheduled") => ({ assigned_staff_id: assigned, status });

describe("jobAccessError", () => {
  it("never limits owner or office", () => {
    for (const role of ["owner", "office"] as const) {
      expect(jobAccessError({ role, myStaffId: null, job: open(other, "complete"), nextStatus: "scheduled" })).toBeNull();
    }
  });

  it("lets a tech work a job assigned to them", () => {
    expect(jobAccessError({ role: "tech", myStaffId: me, job: open(me), nextStatus: "in_progress" })).toBeNull();
  });

  it("lets a tech pick an unassigned job", () => {
    expect(jobAccessError({ role: "tech", myStaffId: me, job: open(null), nextStatus: "in_progress" })).toBeNull();
  });

  it("blocks a tech on a job assigned to someone else", () => {
    expect(jobAccessError({ role: "tech", myStaffId: me, job: open(other), nextStatus: "complete" })).not.toBeNull();
    expect(jobAccessError({ role: "tech", myStaffId: me, job: open(other) })).not.toBeNull();
  });

  it("blocks a tech with no staff row, such as a stray session", () => {
    expect(jobAccessError({ role: "tech", myStaffId: null, job: open(null) })).not.toBeNull();
  });

  it("only lets a tech set in_progress or complete", () => {
    for (const status of ["scheduled", "cancelled", "pending", "completed", ""]) {
      expect(jobAccessError({ role: "tech", myStaffId: me, job: open(me), nextStatus: status })).not.toBeNull();
    }
    expect(jobAccessError({ role: "tech", myStaffId: me, job: open(me), nextStatus: "complete" })).toBeNull();
  });

  it("does not let a tech reopen a finished or cancelled job", () => {
    for (const status of ["complete", "completed", "cancelled"]) {
      expect(jobAccessError({ role: "tech", myStaffId: me, job: open(me, status), nextStatus: "in_progress" })).not.toBeNull();
    }
  });

  it("can allow adding to a finished job when the caller says so", () => {
    expect(
      jobAccessError({ role: "tech", myStaffId: me, job: open(me, "complete"), allowClosedJob: true })
    ).toBeNull();
  });

  it("fails closed when the job is missing", () => {
    expect(jobAccessError({ role: "tech", myStaffId: me, job: null })).not.toBeNull();
  });

  it("lets a tech add a report to their own finished job, never someone else's", () => {
    // Service, install and PM reports check with allowClosedJob: a tech often files after Finish.
    expect(jobAccessError({ role: "tech", myStaffId: me, job: open(me, "complete"), allowClosedJob: true })).toBeNull();
    expect(jobAccessError({ role: "tech", myStaffId: me, job: open(null, "complete"), allowClosedJob: true })).toBeNull();
    expect(
      jobAccessError({ role: "tech", myStaffId: me, job: open(other, "complete"), allowClosedJob: true })
    ).not.toBeNull();
  });
});

describe("jobAccessMessage", () => {
  it("turns a bare Not allowed into a plain sentence", () => {
    expect(jobAccessMessage(new Error("Not allowed"))).toBe("You can't work on this job.");
  });

  it("keeps the job rule's own message", () => {
    expect(jobAccessMessage(new Error("This job is assigned to someone else"))).toBe(
      "This job is assigned to someone else"
    );
    expect(jobAccessMessage(new Error("Job not found"))).toBe("Job not found");
  });

  it("never shows a blank or odd thrown value", () => {
    expect(jobAccessMessage("boom")).toBe("You can't work on this job.");
    expect(jobAccessMessage(undefined)).toBe("You can't work on this job.");
    expect(jobAccessMessage(new Error(""))).toBe("You can't work on this job.");
  });
});
