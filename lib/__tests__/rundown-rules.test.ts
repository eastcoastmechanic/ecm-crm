import { describe, expect, it } from "vitest";
import {
  TEXT_DRAFT_END,
  TEXT_DRAFT_START,
  bucketFor,
  cardChanges,
  cardDescription,
  desiredCard,
  labelSlotsFor,
  mergeRun,
  parseRundownBody,
  planLabelNames,
  pulledStatus,
  pushedAfter,
  pushedFrom,
  readTextDraft,
  sha,
  type RundownBody,
  type RundownItemRow,
} from "../rundown-rules";

const JOB = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-11-27T03:00:00.000Z";

function body(items: RundownBody["items"], extra: Partial<RundownBody> = {}): RundownBody {
  const parsed = parseRundownBody({ date: "2026-11-26", items, ...extra });
  if (!parsed.ok) throw new Error(parsed.errors.join("; "));
  return parsed.body;
}

function row(over: Partial<RundownItemRow> = {}): RundownItemRow {
  return {
    bot: "grok",
    key: "job:abc",
    section: "next",
    title: "Call back about the boiler",
    detail: null,
    due: null,
    priority: "normal",
    source: null,
    job_id: null,
    lead_id: null,
    customer_id: null,
    text_draft: null,
    status: "open",
    first_run_date: "2026-11-25",
    last_run_date: "2026-11-25",
    last_seen_at: "2026-11-26T03:00:00.000Z",
    last_run_id: null,
    needs_push: false,
    done_at: null,
    done_by: null,
    done_source: null,
    ...over,
  };
}

describe("parseRundownBody", () => {
  it("accepts the documented example shape", () => {
    const parsed = parseRundownBody({
      date: "2026-11-26",
      period: { from: "2026-11-25T22:00:00-05:00", to: "2026-11-26T22:00:00-05:00" },
      summary: "Quiet day.",
      items: [
        {
          key: "quo:thread-123",
          section: "waiting",
          title: "Approve text to customer",
          detail: "Asked for a Tuesday slot",
          due: "2026-11-27",
          priority: "urgent",
          source: "quo",
          job_id: JOB,
          lead_id: null,
          customer_id: CUSTOMER,
          text_draft: { customer_id: CUSTOMER, body: "Tuesday at 9 works. See you then." },
        },
      ],
      closed_keys: ["job:old"],
    });
    expect(parsed.ok).toBe(true);
  });

  it("names the bad field", () => {
    const parsed = parseRundownBody({ date: "11/26/2026", items: [{ key: "a", section: "later", title: "" }] });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors.some((e) => e.startsWith("date"))).toBe(true);
      expect(parsed.errors.some((e) => e.startsWith("items.0.section"))).toBe(true);
      expect(parsed.errors.some((e) => e.startsWith("items.0.title"))).toBe(true);
    }
  });

  it("rejects keys with spaces and too many items", () => {
    expect(parseRundownBody({ date: "2026-11-26", items: [{ key: "has space", section: "next", title: "x" }] }).ok).toBe(false);
    const many = Array.from({ length: 201 }, (_, i) => ({ key: `k${i}`, section: "next", title: "x" }));
    expect(parseRundownBody({ date: "2026-11-26", items: many }).ok).toBe(false);
  });
});

describe("mergeRun", () => {
  it("creates new items open and flagged for Planner", () => {
    const out = mergeRun({ bot: "grok", body: body([{ key: "job:abc", section: "next", title: "Call back" }]), runId: "r1", now: NOW, existing: [] });
    expect(out.created).toEqual(["job:abc"]);
    expect(out.rows[0]).toMatchObject({ status: "open", needs_push: true, first_run_date: "2026-11-26", priority: "normal" });
  });

  it("same key, same content: only last seen moves, no Planner write", () => {
    const prev = row();
    const out = mergeRun({
      bot: "grok",
      body: body([{ key: prev.key, section: "next", title: prev.title }]),
      runId: "r2",
      now: NOW,
      existing: [prev],
    });
    expect(out.unchanged).toEqual([prev.key]);
    expect(out.rows[0]).toMatchObject({ needs_push: false, last_run_date: "2026-11-26", last_seen_at: NOW, first_run_date: "2026-11-25" });
  });

  it("same key, changed section: updated and flagged", () => {
    const out = mergeRun({
      bot: "grok",
      body: body([{ key: "job:abc", section: "waiting", title: "Call back about the boiler" }]),
      runId: "r2",
      now: NOW,
      existing: [row()],
    });
    expect(out.updated).toEqual(["job:abc"]);
    expect(out.rows[0]).toMatchObject({ section: "waiting", needs_push: true });
  });

  it("never reopens an item Josh finished", () => {
    const done = row({ status: "done", done_source: "planner", done_by: "user-1" });
    const out = mergeRun({
      bot: "grok",
      body: body([{ key: done.key, section: "next", title: "Changed title" }]),
      runId: "r2",
      now: NOW,
      existing: [done],
    });
    expect(out.alreadyDone).toEqual([done.key]);
    expect(out.rows[0]).toMatchObject({ status: "done", title: done.title, needs_push: false });
  });

  it("closed_keys closes open items by the bot, warns on unknown ones", () => {
    const open = row({ key: "lead:1" });
    const out = mergeRun({
      bot: "grok",
      body: body([], { closed_keys: ["lead:1", "nope"] }),
      runId: "r2",
      now: NOW,
      existing: [open],
    });
    expect(out.closed).toEqual(["lead:1"]);
    expect(out.rows[0]).toMatchObject({ status: "done", done_by: "bot:grok", done_source: "grok", needs_push: true });
    expect(out.warnings).toContain("closed key nope not found");
  });

  it("closes What happened items not repeated for two days, keeps fresh ones", () => {
    const old = row({ key: "board:1", section: "happened", last_run_date: "2026-11-24" });
    const fresh = row({ key: "board:2", section: "happened", last_run_date: "2026-11-25" });
    const out = mergeRun({ bot: "grok", body: body([]), runId: "r", now: NOW, existing: [], openHappened: [old, fresh] });
    expect(out.autoClosed).toEqual(["board:1"]);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({ key: "board:1", status: "done", done_source: "auto" });
  });

  it("keeps items Grok stopped sending open (does not touch them)", () => {
    const out = mergeRun({ bot: "grok", body: body([]), runId: "r", now: NOW, existing: [], openHappened: [] });
    expect(out.rows).toEqual([]);
  });

  it("duplicate keys in one run: last wins with a warning", () => {
    const out = mergeRun({
      bot: "grok",
      body: body([
        { key: "a", section: "next", title: "first" },
        { key: "a", section: "next", title: "second" },
      ]),
      runId: "r",
      now: NOW,
      existing: [],
    });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].title).toBe("second");
    expect(out.warnings[0]).toMatch(/more than once/);
  });
});

describe("card layout", () => {
  it("text drafts go to Texts to approve, otherwise the section's bucket", () => {
    expect(bucketFor({ section: "waiting", text_draft: { customer_id: CUSTOMER, body: "hi" } })).toBe("texts");
    expect(bucketFor({ section: "money", text_draft: null })).toBe("money");
  });

  it("labels: priority and type", () => {
    const slots = labelSlotsFor(
      row({ priority: "urgent", job_id: JOB, section: "money", source: "email", text_draft: { customer_id: CUSTOMER, body: "x" } })
    );
    const names = planLabelNames();
    expect(slots.map((s) => names[s]).sort()).toEqual(["Email", "Job", "Money", "Text", "Urgent"]);
    expect(labelSlotsFor(row())).toEqual([]);
  });

  it("every label has its own slot", () => {
    const slots = Object.keys(planLabelNames());
    expect(new Set(slots).size).toBe(7);
  });

  it("description carries detail, marked draft, CRM links and the key; draft reads back", () => {
    const item = row({
      detail: "Customer asked for Tuesday.",
      job_id: JOB,
      text_draft: { customer_id: CUSTOMER, body: "Tuesday at 9 works." },
    });
    const text = cardDescription(item, "https://crm.example/");
    expect(text).toContain("Customer asked for Tuesday.");
    expect(text).toContain(TEXT_DRAFT_START);
    expect(text).toContain(TEXT_DRAFT_END);
    expect(text).toContain(`https://crm.example/jobs?view=list#job-${JOB}`);
    expect(text).toContain(`https://crm.example/customers/${CUSTOMER}`);
    expect(text).toContain("Rundown item: grok/job:abc");
    expect(readTextDraft(text)).toBe("Tuesday at 9 works.");
    expect(readTextDraft(text.replace("Tuesday at 9 works.", "Tuesday at 10 works, thanks."))).toBe("Tuesday at 10 works, thanks.");
    expect(readTextDraft("no markers")).toBeNull();
  });
});

describe("cardChanges", () => {
  const app = "https://crm.example";

  it("nothing to send when the card matches what was pushed", () => {
    const desired = desiredCard(row(), app);
    expect(cardChanges(desired, pushedFrom(desired))).toEqual({});
  });

  it("section change moves the card; due change re-dates it", () => {
    const before = desiredCard(row(), app);
    const after = desiredCard(row({ section: "waiting", due: "2026-11-30" }), app);
    expect(cardChanges(after, pushedFrom(before))).toMatchObject({ bucket: "waiting", due: "2026-11-30" });
  });

  it("clearing a due date sends null", () => {
    const before = desiredCard(row({ due: "2026-11-30" }), app);
    const after = desiredCard(row(), app);
    expect(cardChanges(after, pushedFrom(before)).due).toBeNull();
  });

  it("labels send only the slots that change", () => {
    const before = desiredCard(row({ priority: "urgent" }), app);
    const after = desiredCard(row({ priority: "important" }), app);
    const labels = cardChanges(after, pushedFrom(before)).labels!;
    expect(Object.values(labels).sort()).toEqual([false, true]);
  });

  it("keeps Josh's edited description, still writes other changes", () => {
    const before = desiredCard(row({ text_draft: { customer_id: CUSTOMER, body: "v1" } }), app);
    const after = desiredCard(row({ title: "New title", text_draft: { customer_id: CUSTOMER, body: "v2" } }), app);
    const pushed = pushedFrom(before);
    const changes = cardChanges(after, pushed, sha("Josh rewrote this"));
    expect(changes.description).toBeUndefined();
    expect(changes.title).toBe("New title");
    // Untouched in Planner: our new wording goes in.
    expect(cardChanges(after, pushed, pushed.descHash).description).toBe(after.description);
    // The record keeps our old hash so Josh's text stays protected.
    expect(pushedAfter(after, pushed, changes).descHash).toBe(pushed.descHash);
  });

  it("completes a card once, never reopens", () => {
    const open = desiredCard(row(), app);
    const done = desiredCard(row({ status: "done" }), app);
    expect(cardChanges(done, pushedFrom(open)).complete).toBe(true);
    expect(cardChanges(open, pushedFrom(done)).complete).toBeUndefined();
    expect(pushedAfter(open, pushedFrom(done), {}).complete).toBe(true);
  });
});

describe("pulledStatus", () => {
  const tasks = new Map([
    ["t-done", { percentComplete: 100, completedDateTime: "2026-11-27T14:00:00Z", completedBy: "josh-id" }],
    ["t-open", { percentComplete: 0, completedDateTime: null, completedBy: null }],
  ]);

  it("completed card: done by whoever completed it", () => {
    expect(pulledStatus({ status: "open", planner_task_id: "t-done" }, tasks)).toEqual({
      status: "done",
      doneAt: "2026-11-27T14:00:00Z",
      doneBy: "josh-id",
    });
  });

  it("missing card: dropped; open card or no card: nothing", () => {
    expect(pulledStatus({ status: "open", planner_task_id: "t-gone" }, tasks)).toEqual({ status: "dropped" });
    expect(pulledStatus({ status: "open", planner_task_id: "t-open" }, tasks)).toBeNull();
    expect(pulledStatus({ status: "open", planner_task_id: null }, tasks)).toBeNull();
    expect(pulledStatus({ status: "done", planner_task_id: "t-gone" }, tasks)).toBeNull();
  });
});
