import { describe, expect, it } from "vitest";
import {
  buildCustomerTimeline,
  countByFilter,
  filterTimeline,
  firstLine,
  parseTimelineFilter,
  timelineWhen,
  type DocumentRow,
  type JobRow,
} from "../customer-timeline";

const JOB = "11111111-2222-3333-4444-555555555555";
const DOC = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function job(over: Partial<JobRow> = {}): JobRow {
  return {
    id: JOB,
    job_type: "service",
    status: "complete",
    notes: null,
    created_via: "manual",
    created_at: null,
    scheduled_at: null,
    on_way_at: null,
    arrived_at: null,
    completed_at: null,
    review_request_sent_at: null,
    review_reminder_sent_at: null,
    ...over,
  };
}

function doc(over: Partial<DocumentRow> = {}): DocumentRow {
  return {
    id: DOC,
    doc_number: "INV-1001",
    type: "invoice",
    status: "paid",
    total: 450,
    created_at: null,
    sent_at: null,
    signed_at: null,
    paid_at: null,
    payment_source: null,
    deposit_received_cents: null,
    deposit_received_at: null,
    deposit_method: null,
    ...over,
  };
}

describe("timelineWhen", () => {
  it("skips missing and unreadable times instead of showing 1970", () => {
    expect(timelineWhen(null)).toBeNull();
    expect(timelineWhen(undefined)).toBeNull();
    expect(timelineWhen("")).toBeNull();
    expect(timelineWhen("not a date")).toBeNull();
    expect(timelineWhen("1970-01-01T00:00:00Z")).toBeNull();
  });

  it("prints New York time, not UTC", () => {
    // 01:30 UTC on Nov 10 is 8:30 PM on Nov 9 in New York (EST).
    expect(timelineWhen("2026-11-10T01:30:00Z")?.when).toBe("11/9/2026, 8:30 PM");
    // Summer: EDT, UTC-4.
    expect(timelineWhen("2026-07-04T16:00:00+00:00")?.when).toBe("7/4/2026, 12:00 PM");
  });

  it("prints a date-only column as that date and sorts it at noon New York", () => {
    const w = timelineWhen("2026-11-09");
    expect(w?.when).toBe("11/9/2026");
    expect(new Date(w!.at).toISOString()).toBe("2026-11-09T17:00:00.000Z");
  });
});

describe("firstLine", () => {
  it("takes the first non-blank line and cuts long ones", () => {
    expect(firstLine("\n  hello there \nsecond")).toBe("hello there");
    expect(firstLine(null)).toBe("");
    expect(firstLine("x".repeat(200), 10)).toBe(`${"x".repeat(9)}…`);
  });
});

describe("buildCustomerTimeline", () => {
  it("merges every source newest first", () => {
    const items = buildCustomerTimeline(
      {
        jobs: [job({ created_at: "2026-10-01T13:00:00Z", completed_at: "2026-10-03T18:00:00Z" })],
        documents: [doc({ created_at: "2026-10-03T19:00:00Z", paid_at: "2026-10-05T12:00:00Z", payment_source: "stripe" })],
        jobNotes: [{ id: "n1", job_id: JOB, author_name: "Josh", body: "Replaced capacitor\nmore", created_at: "2026-10-03T17:00:00Z" }],
        conversations: [
          {
            id: "c1",
            channel: "sms",
            created_at: "2026-09-30T12:00:00Z",
            updated_at: "2026-10-06T12:00:00Z",
            transcript: [
              { role: "user", content: "AC is not cooling" },
              { role: "assistant", content: "Thanks, we will call you" },
              { role: "user", content: "Thank you!" },
            ],
          },
        ],
        surveys: [{ id: "s1", job_id: JOB, rating: 5, comment: "Great", created_at: "2026-10-07T12:00:00Z" }],
        campaignSends: [{ id: 7, kind: "tuneup_spring", channel: "sms", sent_at: "2026-04-01T14:00:00Z", error: null }],
        squarePayments: [{ id: "p1", status: "COMPLETED", total_cents: 12500, source_type: "CARD", square_created_at: "2026-08-01T12:00:00Z" }],
        logEntries: [{ id: "l1", section: "texts", body: "Called back", job_id: null, created_at: "2026-10-02T12:00:00Z" }],
      },
      { showMoney: true }
    );

    expect(items.map((i) => i.label)).toEqual([
      "Survey answered",
      "Text in (latest)",
      "Invoice paid",
      "Invoice created",
      "Job finished",
      "Job note",
      "Log: texts",
      "Service job created",
      "Text in",
      "Square payment",
      "Campaign text",
    ]);
    for (let i = 1; i < items.length; i++) expect(items[i - 1].at).toBeGreaterThanOrEqual(items[i].at);

    const paid = items.find((i) => i.label === "Invoice paid")!;
    expect(paid.summary).toBe("Invoice INV-1001 · $450.00 · card (Stripe)");
    expect(paid.href).toBe(`/documents/${DOC}`);
    expect(items.find((i) => i.label === "Job note")!.summary).toBe("Josh · Replaced capacitor");
    expect(items.find((i) => i.label === "Job finished")!.href).toBe(`/jobs?view=list#job-${JOB}`);
    expect(items.find((i) => i.label === "Text in (latest)")!.summary).toBe("Thank you!");
    expect(items.find((i) => i.label === "Square payment")!.summary).toBe("$125.00 · card · completed");
  });

  it("shows a Square refund under Money, with the amount only when money is on", () => {
    const refunds = [{ id: "r1", status: "COMPLETED", amount_cents: 2500, reason: "Duplicate charge", square_created_at: "2026-08-02T12:00:00Z" }];
    const withMoney = buildCustomerTimeline({ squareRefunds: refunds }, { showMoney: true });
    expect(withMoney).toHaveLength(1);
    expect(withMoney[0]).toMatchObject({ label: "Square refund", category: "money", summary: "$25.00 · Duplicate charge · completed" });
    const noMoney = buildCustomerTimeline({ squareRefunds: refunds }, { showMoney: false });
    expect(noMoney[0].summary).toBe("Duplicate charge · completed");
  });

  it("leaves out events with no time rather than dating them 1970", () => {
    const items = buildCustomerTimeline(
      { jobs: [job({ created_at: "2026-10-01T13:00:00Z", scheduled_at: null, completed_at: null })], documents: [doc()] },
      { showMoney: true }
    );
    expect(items).toHaveLength(1);
    expect(items[0].when).not.toContain("1970");
  });

  it("hides every amount when money is off", () => {
    const items = buildCustomerTimeline(
      {
        documents: [
          doc({
            type: "contract",
            doc_number: "CON-1",
            total: 9000,
            created_at: "2026-10-01T12:00:00Z",
            signed_at: "2026-10-02T12:00:00Z",
            deposit_received_cents: 450000,
            deposit_received_at: "2026-10-03",
            deposit_method: "check",
          }),
        ],
        squarePayments: [{ id: "p1", status: "COMPLETED", total_cents: 12500, source_type: "CARD", square_created_at: "2026-08-01T12:00:00Z" }],
      },
      { showMoney: false }
    );
    expect(items.length).toBe(4);
    for (const item of items) expect(item.summary).not.toMatch(/\$/);
    expect(items.find((i) => i.label === "Deposit received")!.summary).toBe("Contract CON-1 · check");
  });

  it("shows a phone call under Calls and a one-message text thread once", () => {
    const items = buildCustomerTimeline(
      {
        conversations: [
          {
            id: "v1",
            channel: "voice",
            created_at: "2026-10-01T12:00:00Z",
            updated_at: "2026-10-01T12:05:00Z",
            transcript: [
              { role: "assistant", content: "Thanks for calling" },
              { role: "user", content: "I need a tune-up" },
            ],
          },
          {
            id: "t1",
            channel: "sms",
            created_at: "2026-10-02T12:00:00Z",
            updated_at: "2026-10-02T12:00:00Z",
            transcript: [{ role: "assistant", content: "Your visit is tomorrow" }],
          },
        ],
      },
      { showMoney: true }
    );
    expect(items.map((i) => [i.category, i.label])).toEqual([
      ["texts", "Text out"],
      ["calls", "Phone call"],
    ]);
    expect(items[1].summary).toBe("Answered by the phone receptionist · I need a tune-up");
    expect(items[1].href).toBe("/conversations/v1");
  });

  it("drops a log entry seen twice (linked to the customer and to their job)", () => {
    const entry = { id: "l1", section: "jobs", body: "x", job_id: JOB, created_at: "2026-10-02T12:00:00Z" };
    expect(buildCustomerTimeline({ logEntries: [entry, entry] }, { showMoney: true })).toHaveLength(1);
  });
});

describe("filters", () => {
  const items = buildCustomerTimeline(
    {
      jobs: [job({ created_at: "2026-10-01T13:00:00Z", review_request_sent_at: "2026-10-04T13:00:00Z" })],
      documents: [doc({ created_at: "2026-10-03T19:00:00Z" })],
      jobNotes: [{ id: "n1", job_id: JOB, author_name: null, body: "note", created_at: "2026-10-03T17:00:00Z" }],
    },
    { showMoney: true }
  );

  it("filters by category and counts each chip", () => {
    expect(filterTimeline(items, "all")).toHaveLength(4);
    expect(filterTimeline(items, "texts").map((i) => i.label)).toEqual(["Review request texted"]);
    expect(filterTimeline(items, "money").map((i) => i.label)).toEqual(["Invoice created"]);
    expect(filterTimeline(items, "calls")).toEqual([]);
    expect(countByFilter(items)).toEqual({ all: 4, texts: 1, calls: 0, money: 1, jobs: 1, notes: 1 });
  });

  it("reads the filter from the URL, defaulting to all", () => {
    expect(parseTimelineFilter("money")).toBe("money");
    expect(parseTimelineFilter(["calls"])).toBe("calls");
    expect(parseTimelineFilter("junk")).toBe("all");
    expect(parseTimelineFilter(undefined)).toBe("all");
  });
});
