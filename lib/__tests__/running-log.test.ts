import { describe, expect, it } from "vitest";
import {
  buildLogTeamsCard,
  LOG_TEAMS_CHANNEL,
  logEntryLine,
  matchLogEntries,
  normalizeSectionName,
  parseAddLogToolInput,
  parseLogTarget,
  foldPatch,
  groupLogEntries,
  isLogTableMissing,
  jobLabel,
  limitParam,
  MAX_LOG_LENGTH,
  parseOptionalId,
  parseSection,
  summaryLine,
  validateLogInput,
} from "../running-log";

const JOB = "11111111-2222-3333-4444-555555555555";
const CUSTOMER = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("parseSection", () => {
  it("accepts the four sections only", () => {
    expect(parseSection("texts")).toBe("texts");
    expect(parseSection("vendors")).toBe("vendors");
    expect(parseSection("parts")).toBeNull();
    expect(parseSection(null)).toBeNull();
  });
});

describe("parseOptionalId", () => {
  it("blank is null, uuid passes, junk is bad", () => {
    expect(parseOptionalId("")).toBeNull();
    expect(parseOptionalId(null)).toBeNull();
    expect(parseOptionalId(` ${JOB} `)).toBe(JOB);
    expect(parseOptionalId("abc")).toBe("bad");
  });
});

describe("validateLogInput", () => {
  it("trims the text", () => {
    const r = validateLogInput({ section: "plans", body: "  call supply house  " });
    expect(r).toEqual({ value: { section: "plans", body: "call supply house", jobId: null, customerId: null } });
  });

  it("refuses a bad section, blank text and text that is too long", () => {
    expect(validateLogInput({ section: "other", body: "x" })).toEqual({ error: "Pick a section." });
    expect(validateLogInput({ section: "jobs", body: "   " })).toEqual({ error: "Write something first." });
    expect("error" in validateLogInput({ section: "jobs", body: "x".repeat(MAX_LOG_LENGTH + 1) })).toBe(true);
    expect("value" in validateLogInput({ section: "jobs", body: "x".repeat(MAX_LOG_LENGTH) })).toBe(true);
  });

  it("keeps a job only on Jobs and a customer only on Texts", () => {
    expect(validateLogInput({ section: "jobs", body: "a", jobId: JOB, customerId: CUSTOMER })).toEqual({
      value: { section: "jobs", body: "a", jobId: JOB, customerId: null },
    });
    expect(validateLogInput({ section: "texts", body: "a", jobId: JOB, customerId: CUSTOMER })).toEqual({
      value: { section: "texts", body: "a", jobId: null, customerId: CUSTOMER },
    });
    expect(validateLogInput({ section: "plans", body: "a", jobId: JOB, customerId: CUSTOMER })).toEqual({
      value: { section: "plans", body: "a", jobId: null, customerId: null },
    });
  });

  it("refuses a malformed job or customer id", () => {
    expect("error" in validateLogInput({ section: "jobs", body: "a", jobId: "nope" })).toBe(true);
    expect("error" in validateLogInput({ section: "texts", body: "a", customerId: "nope" })).toBe(true);
  });
});

describe("groupLogEntries", () => {
  it("splits open and folded, newest first", () => {
    const entries = [
      { id: "a", folded: false, created_at: "2026-11-01T10:00:00Z" },
      { id: "b", folded: true, created_at: "2026-11-03T10:00:00Z" },
      { id: "c", folded: false, created_at: "2026-11-05T10:00:00Z" },
      { id: "d", folded: true, created_at: "2026-11-02T10:00:00Z" },
    ];
    const { open, folded } = groupLogEntries(entries);
    expect(open.map((e) => e.id)).toEqual(["c", "a"]);
    expect(folded.map((e) => e.id)).toEqual(["b", "d"]);
  });
});

describe("summaryLine", () => {
  it("keeps short text and squashes line breaks", () => {
    expect(summaryLine("Called\n  back   later")).toBe("Called back later");
  });
  it("cuts long text at 80 characters with an ellipsis", () => {
    const line = summaryLine("word ".repeat(40));
    expect(line.length).toBeLessThanOrEqual(80);
    expect(line.endsWith("…")).toBe(true);
  });
});

describe("foldPatch", () => {
  it("stamps folded_at when folding and clears it when unfolding", () => {
    const now = new Date("2026-11-09T15:00:00Z");
    expect(foldPatch(true, now)).toEqual({ folded: true, folded_at: "2026-11-09T15:00:00.000Z" });
    expect(foldPatch(false, now)).toEqual({ folded: false, folded_at: null });
  });
});

describe("isLogTableMissing", () => {
  it("spots the missing-table errors only", () => {
    expect(isLogTableMissing('relation "public.log_entries" does not exist')).toBe(true);
    expect(isLogTableMissing("Could not find the table 'public.log_entries' in the schema cache")).toBe(true);
    expect(isLogTableMissing("permission denied")).toBe(false);
    expect(isLogTableMissing(null)).toBe(false);
  });
});

describe("Teams channel per section", () => {
  it("Plans to General, Texts to Leads, Vendors to Parts, Jobs to Job Notes", () => {
    expect(LOG_TEAMS_CHANNEL).toEqual({ plans: "general", texts: "leads", vendors: "parts", jobs: "job_notes" });
  });
});

describe("buildLogTeamsCard", () => {
  const base = { body: "Order 3 ton coil", createdAt: "2026-11-09T18:05:00Z", baseUrl: "https://crm.test/" };

  it("shows section, text, author, New York time and links to the log section", () => {
    const card = buildLogTeamsCard({ ...base, section: "vendors", author: "Josh" });
    expect(card.title).toBe("Log · Vendors / parts");
    expect(card.text).toContain("Order 3 ton coil");
    expect(card.text).toContain("Josh · 11/9/2026, 1:05 PM");
    expect(card.url).toBe("https://crm.test/log#log-vendors");
  });

  it("links the job when there is one", () => {
    const card = buildLogTeamsCard({ ...base, section: "jobs", author: "Josh", jobId: JOB, jobLabel: "A — 1 Main St · 11/9/2026" });
    expect(card.text).toContain("Job: A — 1 Main St · 11/9/2026");
    expect(card.url).toBe(`https://crm.test/jobs?view=list#job-${JOB}`);
  });

  it("names the customer on a Texts entry", () => {
    const card = buildLogTeamsCard({ ...base, section: "texts", author: "Josh", customerName: "Pat" });
    expect(card.text).toContain("Customer: Pat");
  });

  it("marks an entry written through the Teams agent", () => {
    expect(buildLogTeamsCard({ ...base, section: "plans", author: null, via: "Teams agent" }).text).toContain(
      "via Teams agent · 11/9/2026"
    );
    expect(buildLogTeamsCard({ ...base, section: "plans", author: "Josh", via: "assistant" }).text).toContain(
      "Josh (via assistant)"
    );
  });
});

describe("assistant tool input", () => {
  it("reads section names the way people type them", () => {
    expect(normalizeSectionName("Plans")).toBe("plans");
    expect(normalizeSectionName("text")).toBe("texts");
    expect(normalizeSectionName("Vendors / parts")).toBe("vendors");
    expect(normalizeSectionName("parts")).toBe("vendors");
    expect(normalizeSectionName("job")).toBe("jobs");
    expect(normalizeSectionName("money")).toBeNull();
  });

  it("add_log_entry: refuses a job on the wrong section instead of dropping it", () => {
    expect(parseAddLogToolInput({ section: "Plans", text: "call Ferguson" })).toEqual({
      value: { section: "plans", body: "call Ferguson", jobId: null, customerId: null },
    });
    expect(parseAddLogToolInput({ section: "Plans", text: "x", jobId: JOB })).toEqual({
      error: "Only a Jobs entry can link a job.",
    });
    expect(parseAddLogToolInput({ section: "Jobs", text: "x", customerId: CUSTOMER })).toEqual({
      error: "Only a Texts entry can link a customer.",
    });
    expect(parseAddLogToolInput({ section: "jobs", text: "x", jobId: JOB })).toEqual({
      value: { section: "jobs", body: "x", jobId: JOB, customerId: null },
    });
    expect("error" in parseAddLogToolInput({ section: "nope", text: "x" })).toBe(true);
    expect("error" in parseAddLogToolInput({ section: "plans", text: "  " })).toBe(true);
  });

  it("fold target: id, or at least 3 characters of text", () => {
    expect(parseLogTarget({ id: JOB })).toEqual({ id: JOB });
    expect(parseLogTarget({ match: " coil " })).toEqual({ match: "coil" });
    expect("error" in parseLogTarget({ id: "12" })).toBe(true);
    expect("error" in parseLogTarget({ match: "ab" })).toBe(true);
    expect("error" in parseLogTarget({})).toBe(true);
  });

  it("text match ignores case and spacing", () => {
    const entries = [{ body: "Order 3 ton  COIL" }, { body: "Call supply house" }, { body: "coil for Smith" }];
    expect(matchLogEntries(entries, "3 ton coil")).toHaveLength(1);
    expect(matchLogEntries(entries, "coil")).toHaveLength(2);
    expect(matchLogEntries(entries, "   ")).toHaveLength(0);
  });

  it("lists an entry with its id, time, section and author", () => {
    const line = logEntryLine({
      id: JOB,
      section: "plans",
      body: "Call\nFerguson",
      created_at: "2026-11-09T18:05:00Z",
      folded: true,
      author: "Josh",
    });
    expect(line).toBe(`[${JOB}] 11/9/2026, 1:05 PM · Plans · Josh: Call Ferguson (folded)`);
  });
});

describe("jobLabel and limitParam", () => {
  it("names a job by customer, address and New York date, never an id", () => {
    expect(jobLabel({ customerName: "A", address: "1 Main St", scheduledAt: "2026-11-10T02:00:00Z" })).toBe(
      "A — 1 Main St · 11/9/2026"
    );
    expect(jobLabel({})).toBe("Job with no customer · not scheduled");
  });
  it("gives each section its own Show older params", () => {
    expect(limitParam("texts", "open")).toBe("texts");
    expect(limitParam("texts", "folded")).toBe("texts_folded");
  });
});
