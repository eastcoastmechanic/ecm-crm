import { describe, expect, it } from "vitest";
import { buildTechNotice, type NoticeJob } from "../tech-notice";

const job: NoticeJob = {
  id: "j1",
  scheduledAt: "2026-11-06T14:00:00.000Z", // Fri 9:00 AM New York (EST)
  jobType: "service",
  customer: "Test Customer",
  address: "1 Main St",
  phone: "508-555-0100",
  accessNotes: "Gate code on file",
};

describe("buildTechNotice", () => {
  it("tells a tech about a new job with the details they need", () => {
    const n = buildTechNotice({ kind: "assigned", techName: "Sam", job, now: new Date("2026-11-05T15:00:00Z") });
    expect(n.subject).toContain("New job: Test Customer");
    expect(n.subject).not.toContain("TODAY");
    expect(n.text).toContain("Where: 1 Main St");
    expect(n.text).toContain("Phone: 508-555-0100");
    expect(n.text).toContain("Access: Gate code on file");
    expect(n.teamsTitle).toContain("Sam");
  });

  it("flags a job that is today, in New York time", () => {
    const n = buildTechNotice({ kind: "assigned", techName: "Sam", job, now: new Date("2026-11-06T12:00:00Z") });
    expect(n.subject.startsWith("TODAY: ")).toBe(true);
  });

  it("handles a job with no time yet", () => {
    const n = buildTechNotice({ kind: "assigned", techName: null, job: { ...job, scheduledAt: null } });
    expect(n.text).toContain("not scheduled yet");
    expect(n.teamsTitle).toContain("Tech");
  });

  it("leaves phone and access notes off a cancelled or removed job", () => {
    for (const kind of ["cancelled", "unassigned"] as const) {
      const n = buildTechNotice({ kind, techName: "Sam", job });
      expect(n.text).not.toContain("Phone");
      expect(n.text).not.toContain("Access");
      expect(n.subject.startsWith("TODAY")).toBe(false);
    }
  });

  it("never includes a price", () => {
    const n = buildTechNotice({ kind: "rescheduled", techName: "Sam", job });
    expect(`${n.subject}${n.text}${n.teamsText}`).not.toMatch(/\$\d/);
  });
});
