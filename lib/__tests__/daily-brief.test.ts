import { describe, expect, it, vi } from "vitest";

// The formatters are pure; the module also imports the database client, which needs real env vars.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { formatOwnerBrief, formatTechBrief, type DailyBrief } from "@/lib/daily-brief";

const base: DailyBrief = {
  dateKey: "2026-11-12",
  jobs: [
    { time: "8:00 AM", customer: "Pat Doe", address: "12 Elm St, Plymouth", jobType: "service", tech: "Ryan" },
    { time: "1:30 PM", customer: "Sam Roe", address: "5 Bay Rd, Duxbury", jobType: "install", tech: null },
  ],
  unscheduledRequested: 2,
  overduePlanVisits: 1,
  outstanding: { total: 4250.5, count: 3 },
  leadsDueToday: 1,
  leadsOverdue: 2,
  staleEstimates: 4,
};

describe("formatOwnerBrief", () => {
  it("lists jobs, what needs the owner, and money", () => {
    const { title, text } = formatOwnerBrief(base);
    expect(title).toBe("ECM morning brief, Thursday, Nov 12");
    expect(text).toContain("8:00 AM · Pat Doe · 12 Elm St, Plymouth · service (Ryan)");
    expect(text).toContain("(unassigned)");
    expect(text).toContain("1 job today has no tech assigned");
    expect(text).toContain("2 requested jobs need a time");
    expect(text).toContain("1 plan visit is overdue");
    expect(text).toContain("2 lead follow-ups are overdue");
    expect(text).toContain("1 lead follow-up is due today");
    expect(text).toContain("4 estimates have gone 3+ days with no approval");
    expect(text).toContain("3 invoices unpaid, $4,250.50");
  });

  it("says so when nothing is waiting", () => {
    const { text } = formatOwnerBrief({
      ...base,
      jobs: [],
      unscheduledRequested: 0,
      overduePlanVisits: 0,
      outstanding: { total: 0, count: 0 },
      leadsDueToday: 0,
      leadsOverdue: 0,
      staleEstimates: 0,
    });
    expect(text).toContain("Nothing scheduled.");
    expect(text).toContain("Nothing waiting.");
    expect(text).toContain("No unpaid invoices.");
  });

  it("never shows a piece it could not read as zero", () => {
    const { text } = formatOwnerBrief({
      ...base,
      jobs: null,
      unscheduledRequested: null,
      overduePlanVisits: null,
      outstanding: null,
      leadsDueToday: null,
      leadsOverdue: null,
      staleEstimates: null,
    });
    expect(text).toContain("Couldn't read today's jobs");
    expect(text).toContain("Couldn't check requested jobs");
    expect(text).toContain("Couldn't check plan visits");
    expect(text).toContain("Couldn't check lead follow-ups");
    expect(text).toContain("Couldn't check estimates");
    expect(text).toContain("Couldn't read unpaid invoices");
    expect(text).not.toContain("Nothing waiting.");
    expect(text).not.toContain("No unpaid invoices.");
  });

  it("uses singular wording for one", () => {
    const { text } = formatOwnerBrief({ ...base, unscheduledRequested: 1, staleEstimates: 1, outstanding: { total: 100, count: 1 } });
    expect(text).toContain("1 requested job needs a time");
    expect(text).toContain("1 estimate has gone 3+ days with no approval");
    expect(text).toContain("1 invoice unpaid, $100.00");
  });
});

describe("formatTechBrief", () => {
  it("lists jobs and techs with no money in it", () => {
    const { title, text } = formatTechBrief(base);
    expect(title).toBe("Today's jobs, Thursday, Nov 12");
    expect(text).toContain("8:00 AM · Pat Doe · 12 Elm St, Plymouth · service (Ryan)");
    expect(text).not.toMatch(/\$|unpaid|invoice|estimate|lead/i);
  });

  it("handles no jobs and a failed read", () => {
    expect(formatTechBrief({ ...base, jobs: [] }).text).toBe("Nothing scheduled today.");
    expect(formatTechBrief({ ...base, jobs: null }).text).toContain("Couldn't read today's jobs");
  });
});
