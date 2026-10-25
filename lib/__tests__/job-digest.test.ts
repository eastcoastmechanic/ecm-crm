import { describe, expect, it } from "vitest";
import { buildJobDigests, type DigestJob } from "../job-digest";
import { etHour } from "../tz";

const OWNER = "owner@example.com";

function job(overrides: Partial<DigestJob>): DigestJob {
  return {
    id: "j1",
    scheduledAt: "2026-10-26T13:00:00.000Z", // 9:00 AM New York (EDT)
    jobType: "service",
    status: "scheduled",
    assignedStaffId: null,
    customer: "Test Customer",
    phone: null,
    address: "1 Main St",
    accessNotes: null,
    ...overrides,
  };
}

const staff = [
  { id: "t1", name: "Tech One", email: "tech1@example.com" },
  { id: "t2", name: "Tech Two", email: "tech2@example.com" },
  { id: "o1", name: "Owner", email: "Owner@Example.com" },
];

describe("buildJobDigests", () => {
  it("sends nothing on a day with no jobs", () => {
    expect(buildJobDigests({ jobs: [], staff, ownerEmail: OWNER, dayLabel: "Monday", boardUrl: null })).toEqual([]);
  });

  it("gives each tech only their own jobs and the owner all jobs", () => {
    const emails = buildJobDigests({
      jobs: [
        job({ id: "a", assignedStaffId: "t1", customer: "Alpha" }),
        job({ id: "b", assignedStaffId: "t2", customer: "Bravo" }),
        job({ id: "c", customer: "Charlie" }),
      ],
      staff,
      ownerEmail: OWNER,
      dayLabel: "Monday, Oct 26",
      boardUrl: null,
    });

    const tech1 = emails.find((e) => e.to === "tech1@example.com");
    expect(tech1?.text).toContain("Alpha");
    expect(tech1?.text).not.toContain("Bravo");
    expect(tech1?.text).not.toContain("Charlie");

    const owner = emails.find((e) => e.to === OWNER);
    expect(owner?.subject).toBe("Jobs today, Monday, Oct 26 (3 jobs, 1 unassigned)");
    expect(owner?.text).toContain("Tech One:");
    expect(owner?.text).toContain("Unassigned:");
    expect(owner?.text).toContain("Charlie");
    expect(emails).toHaveLength(3);
  });

  it("does not send the owner a second copy when the owner is also assigned", () => {
    const emails = buildJobDigests({
      jobs: [job({ assignedStaffId: "o1" })],
      staff,
      ownerEmail: OWNER,
      dayLabel: "Monday",
      boardUrl: null,
    });
    expect(emails.map((e) => e.to)).toEqual([OWNER]);
  });

  it("shows the time in New York, plus address, phone and access notes", () => {
    const [email] = buildJobDigests({
      jobs: [job({ phone: "508-555-0100", accessNotes: "Key under mat" })],
      staff,
      ownerEmail: OWNER,
      dayLabel: "Monday",
      boardUrl: "https://example.com/field-board",
    });
    expect(email.text).toContain("9:00 AM  Test Customer (service)");
    expect(email.text).toContain("1 Main St");
    expect(email.text).toContain("Phone: 508-555-0100");
    expect(email.text).toContain("Access: Key under mat");
    expect(email.text).toContain("Field Board: https://example.com/field-board");
  });

  it("skips techs with no email", () => {
    const emails = buildJobDigests({
      jobs: [job({ assignedStaffId: "t3" })],
      staff: [...staff, { id: "t3", name: "No Email", email: null }],
      ownerEmail: OWNER,
      dayLabel: "Monday",
      boardUrl: null,
    });
    expect(emails.map((e) => e.to)).toEqual([OWNER]);
  });
});

describe("etHour", () => {
  it("is 7 at 11:00 UTC in summer (EDT) and 12:00 UTC in winter (EST)", () => {
    expect(etHour(new Date("2026-07-15T11:00:00Z"))).toBe(7);
    expect(etHour(new Date("2026-07-15T12:00:00Z"))).toBe(8);
    expect(etHour(new Date("2026-12-15T12:00:00Z"))).toBe(7);
    expect(etHour(new Date("2026-12-15T11:00:00Z"))).toBe(6);
  });
});
