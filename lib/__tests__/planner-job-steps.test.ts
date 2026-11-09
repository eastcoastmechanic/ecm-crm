import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Call, Handler } from "./fake-supabase";

// Planner cards for leads and job steps, against a fake Graph: the card moves to the
// right bucket, gets one dated line per real step, never gets a money amount, and a job
// or lead never ends up with two cards.

type FakeTask = {
  id: string;
  bucketId: string;
  title: string;
  percentComplete: number;
  appliedCategories: Record<string, boolean>;
  description: string;
};

const h = vi.hoisted(() => ({
  handler: (() => ({})) as Handler,
  calls: [] as Call[],
  graph: [] as { method: string; path: string; body: unknown }[],
  tasks: new Map<string, FakeTask>(),
  categories: {} as Record<string, string | null>,
  nextId: 1,
}));

vi.mock("@/lib/supabase", async () => {
  const { fakeSupabase } = await import("./fake-supabase");
  const fake = fakeSupabase((call) => {
    h.calls.push(call);
    return h.handler(call);
  });
  return { supabase: fake.client };
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { etag: 'W/"etag"', "content-type": "application/json" } });
}

async function fakeGraph(path: string, init: RequestInit = {}): Promise<Response> {
  const method = init.method ?? "GET";
  const body = init.body ? JSON.parse(String(init.body)) : undefined;
  h.graph.push({ method, path, body });

  if (path === "/planner/tasks" && method === "POST") {
    const id = `t${h.nextId++}`;
    const task: FakeTask = {
      id,
      bucketId: body.bucketId,
      title: body.title,
      percentComplete: 0,
      appliedCategories: body.appliedCategories ?? {},
      description: "",
    };
    h.tasks.set(id, task);
    return json({ ...task, "@odata.etag": 'W/"etag"' }, 201);
  }
  if (path === "/planner/plans/plan/details") {
    if (method === "PATCH") Object.assign(h.categories, body.categoryDescriptions);
    return json({ categoryDescriptions: h.categories });
  }
  if (path === "/planner/plans/plan/tasks") {
    return json({ value: [...h.tasks.values()] });
  }
  const details = path.match(/^\/planner\/tasks\/([^/]+)\/details$/);
  if (details) {
    const task = h.tasks.get(details[1]);
    if (!task) return json({}, 404);
    if (method === "PATCH") task.description = body.description;
    return json({ description: task.description });
  }
  const one = path.match(/^\/planner\/tasks\/([^/]+)$/);
  if (one) {
    const task = h.tasks.get(one[1]);
    if (!task) return json({}, 404);
    if (method === "DELETE") {
      h.tasks.delete(task.id);
      return new Response(null, { status: 204 });
    }
    if (method === "PATCH") Object.assign(task, body);
    return json({ ...task, "@odata.etag": 'W/"etag"' });
  }
  return json({ error: `unexpected ${method} ${path}` }, 400);
}

vi.mock("@/lib/graph-auth", () => ({
  GRAPH_BASE: "https://graph.microsoft.com/v1.0",
  graphConfigured: () => true,
  graphFetch: (path: string, init?: RequestInit) => fakeGraph(path, init),
  graphFetchWithRetry: (path: string, init?: RequestInit) => fakeGraph(path, init),
}));

import { createLeadCard, noteJobStep, noteLeadStage, syncJobToPlanner } from "../planner-connector";
import { has, payload } from "./fake-supabase";

beforeAll(() => {
  process.env.MS_PLANNER_PLAN_ID = "plan";
  process.env.MS_PLANNER_BUCKET_TASKS_ID = "b-tasks";
  process.env.MS_PLANNER_BUCKET_JOBS_ID = "b-jobs";
  process.env.MS_PLANNER_BUCKET_IN_PROGRESS_ID = "b-progress";
  process.env.MS_PLANNER_BUCKET_NEEDS_ATTENTION_ID = "b-attention";
  process.env.MS_PLANNER_BUCKET_FINISHED_ID = "b-finished";
  process.env.MS_PLANNER_BUCKET_BILLED_ID = "b-billed";
});

beforeEach(() => {
  h.calls = [];
  h.graph = [];
  h.tasks = new Map();
  h.categories = {};
  h.nextId = 1;
  h.handler = () => ({});
});

function existingCard(bucketId = "b-jobs", description = "Open in CRM: x"): FakeTask {
  const task = { id: "card-1", bucketId, title: "Jane — 12 Main St", percentComplete: 0, appliedCategories: {}, description };
  h.tasks.set(task.id, task);
  return task;
}

/** A job row; `claim` decides whether saving a new card id lands (false: another call saved one first). */
function jobRow(row: Record<string, unknown>, opts: { claim?: boolean; winner?: string } = {}) {
  h.handler = (call) => {
    if (call.table === "staff") return { data: { name: "Mike Jones" } };
    if (call.table !== "jobs") return {};
    if (payload(call, "update")) return { data: opts.claim === false ? [] : [{ id: "job-1" }] };
    if (opts.winner && call.ops.length === 2 && has(call, "select", "planner_task_id")) {
      return { data: { planner_task_id: opts.winner } };
    }
    return {
      data: {
        planner_task_id: null,
        scheduled_at: "2026-11-10T14:00:00Z",
        created_via: "manual",
        notes: null,
        assigned_staff_id: "staff-1",
        customers: { name: "Jane" },
        properties: { address: "12 Main St" },
        ...row,
      },
    };
  };
}

const posts = () => h.graph.filter((g) => g.method === "POST" && g.path === "/planner/tasks");

describe("job steps on the Jobs plan", () => {
  it("On my way moves the card to In Progress and adds one dated line with the tech's name", async () => {
    existingCard();
    jobRow({ planner_task_id: "card-1" });
    await expect(noteJobStep("job-1", "on_way", { at: "2026-11-09T19:15:00Z" })).resolves.toBe(true);
    const card = h.tasks.get("card-1")!;
    expect(card.bucketId).toBe("b-progress");
    expect(card.description).toBe("Open in CRM: x\n11/9 2:15 PM: On the way (Mike)");
    expect(posts()).toHaveLength(0);
  });

  it("a real Finish (note) with no service report goes to Needs Attention with a line", async () => {
    existingCard("b-progress");
    jobRow({ planner_task_id: "card-1" });
    await syncJobToPlanner("job-1", "complete", { note: true, at: "2026-11-09T21:00:00Z" });
    const card = h.tasks.get("card-1")!;
    expect(card.bucketId).toBe("b-attention");
    expect(card.description).toMatch(/4:00 PM: Finished \(Mike\)$/);
  });

  it("a re-sync with no change (report saved) adds no line and doesn't drag a scheduled card back", async () => {
    existingCard("b-attention");
    jobRow({ planner_task_id: "card-1" });
    await syncJobToPlanner("job-1", "scheduled");
    const card = h.tasks.get("card-1")!;
    expect(card.bucketId).toBe("b-attention");
    expect(card.description).toBe("Open in CRM: x");
    expect(h.graph.filter((g) => g.method === "PATCH")).toHaveLength(0);
  });

  it("scheduling sets the due date and names the New York time", async () => {
    existingCard();
    jobRow({ planner_task_id: "card-1" });
    await syncJobToPlanner("job-1", "scheduled", { note: true, at: "2026-11-09T19:15:00Z" });
    const patch = h.graph.find((g) => g.method === "PATCH" && g.path === "/planner/tasks/card-1");
    expect((patch?.body as { dueDateTime?: string }).dueDateTime).toBe("2026-11-10T17:00:00.000Z");
    expect(h.tasks.get("card-1")!.description).toMatch(/Scheduled for Tue 11\/10 9:00 AM \(Mike\)$/);
  });

  it("paid moves to Billed and the line carries no amount", async () => {
    existingCard("b-finished");
    jobRow({ planner_task_id: "card-1" });
    await noteJobStep("job-1", "paid", { docNumber: "INV-0042" });
    const card = h.tasks.get("card-1")!;
    expect(card.bucketId).toBe("b-billed");
    expect(card.description).toMatch(/Invoice INV-0042 paid$/);
    expect(card.description).not.toMatch(/\$|\d+\.\d\d/);
  });

  it("invoice sent leaves the card in Finished", async () => {
    existingCard("b-finished");
    jobRow({ planner_task_id: "card-1" });
    await noteJobStep("job-1", "invoice_sent", { docNumber: "INV-0042" });
    expect(h.tasks.get("card-1")!.bucketId).toBe("b-finished");
    expect(h.tasks.get("card-1")!.description).toMatch(/Invoice INV-0042 sent$/);
  });

  it("an invoice step on a job with no card makes no card", async () => {
    jobRow({});
    await noteJobStep("job-1", "invoice_created", { docNumber: "INV-1" });
    expect(h.graph).toHaveLength(0);
  });

  it("cancelled marks the card complete", async () => {
    existingCard();
    jobRow({ planner_task_id: "card-1" });
    await syncJobToPlanner("job-1", "cancelled", { note: true });
    expect(h.tasks.get("card-1")!.percentComplete).toBe(100);
    expect(h.tasks.get("card-1")!.description).toMatch(/Cancelled$/);
  });

  it("a website request makes one card in Jobs labelled Lead + Website, reusing the Lead label", async () => {
    h.categories = { category1: "Urgent", category2: "lead", category3: null };
    h.tasks.set("other", { id: "other", bucketId: "b-jobs", title: "x", percentComplete: 0, appliedCategories: { category3: true }, description: "" });
    jobRow({ created_via: "web_form", notes: "No heat upstairs" });
    await noteJobStep("job-1", "requested", { at: "2026-11-09T19:15:00Z" });

    expect(posts()).toHaveLength(1);
    const card = h.tasks.get("t1")!;
    expect(card.bucketId).toBe("b-jobs");
    expect(card.title).toBe("Jane — 12 Main St");
    // category3 has no name but is on a card, so Website takes category4; no slot is renamed.
    expect(card.appliedCategories).toEqual({ category2: true, category4: true });
    expect(h.categories).toEqual({ category1: "Urgent", category2: "lead", category3: null, category4: "Website" });
    expect(card.description).toContain("Source: Website");
    expect(card.description).toContain("Request: No heat upstairs");
    expect(card.description).toMatch(/\n11\/9 2:15 PM: Requested from Website, asked for Tue 11\/10 9:00 AM$/);
    // Saved only where the job still had no card.
    const claim = h.calls.find((c) => c.table === "jobs" && payload(c, "update"));
    expect(payload(claim!, "update")).toEqual({ planner_task_id: "t1" });
    expect(has(claim!, "is", "planner_task_id", null)).toBe(true);
  });

  it("if another call saved a card first, this copy is deleted and the line goes on theirs", async () => {
    existingCard();
    jobRow({}, { claim: false, winner: "card-1" });
    await noteJobStep("job-1", "on_site", { at: "2026-11-09T19:15:00Z" });
    expect(h.tasks.has("t1")).toBe(false);
    expect(h.graph.some((g) => g.method === "DELETE" && g.path === "/planner/tasks/t1")).toBe(true);
    expect(h.tasks.get("card-1")!.description).toMatch(/On site \(Mike\)$/);
    expect(h.tasks.get("card-1")!.bucketId).toBe("b-progress");
  });

  it("a Graph failure is logged and the caller carries on", async () => {
    jobRow({ planner_task_id: "missing-card" });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(noteJobStep("job-1", "on_way")).resolves.toBe(false);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("lead cards", () => {
  const lead = {
    id: "lead-1",
    source: "manual",
    contact_name: "Jane Smith",
    phone_number: "508-555-0100",
    contact_info: "jane@example.com",
    address: "12 Main St",
    town: "Plymouth",
    summary: "No heat upstairs",
  };

  function leadRow(opts: { taskId?: string | null; noColumn?: boolean; claim?: boolean } = {}) {
    h.handler = (call) => {
      if (call.table !== "leads") return {};
      if (payload(call, "update")) return { data: opts.claim === false ? [] : [{ id: "lead-1" }] };
      const asksForCard = call.ops.some(([m, cols]) => m === "select" && String(cols).includes("planner_task_id"));
      if (opts.noColumn && asksForCard) return { error: { message: 'column leads.planner_task_id does not exist' } };
      return { data: { ...lead, planner_task_id: opts.taskId ?? null } };
    };
  }

  it("makes one card in Tasks with the Lead and source labels, no phone or email in it", async () => {
    leadRow();
    await expect(createLeadCard("lead-1")).resolves.toBe(true);
    const card = h.tasks.get("t1")!;
    expect(card.bucketId).toBe("b-tasks");
    expect(card.title).toBe("Lead: Jane Smith — No heat upstairs");
    expect(card.appliedCategories).toEqual({ category1: true, category2: true });
    expect(h.categories).toEqual({ category1: "Lead", category2: "Manual" });
    expect(card.description).toContain("Phone: on file");
    expect(card.description).toContain("Email: on file");
    expect(card.description).toContain("/leads");
    expect(card.description).not.toContain("555");
    expect(card.description).not.toContain("example.com");
    const claim = h.calls.find((c) => c.table === "leads" && payload(c, "update"));
    expect(payload(claim!, "update")).toEqual({ planner_task_id: "t1" });
  });

  it("does nothing for a lead that already has a card", async () => {
    leadRow({ taskId: "card-1" });
    await createLeadCard("lead-1");
    expect(posts()).toHaveLength(0);
  });

  it("deletes its copy if another call linked a card first", async () => {
    leadRow({ claim: false });
    await createLeadCard("lead-1");
    expect(h.tasks.size).toBe(0);
  });

  it("before SQL 0079 still makes the card, just doesn't link it", async () => {
    leadRow({ noColumn: true });
    await expect(createLeadCard("lead-1")).resolves.toBe(true);
    expect(posts()).toHaveLength(1);
    expect(h.calls.some((c) => c.table === "leads" && payload(c, "update"))).toBe(false);
  });

  it("Won adds a line and closes the card; a later open stage reopens it", async () => {
    existingCard("b-tasks", "Source: Manual");
    leadRow({ taskId: "card-1" });
    await noteLeadStage("lead-1", "won");
    expect(h.tasks.get("card-1")!.percentComplete).toBe(100);
    expect(h.tasks.get("card-1")!.description).toMatch(/Stage: Won$/);
    await noteLeadStage("lead-1", "quoted");
    expect(h.tasks.get("card-1")!.percentComplete).toBe(0);
  });

  it("a lead with no card is left alone", async () => {
    leadRow();
    await noteLeadStage("lead-1", "lost");
    expect(h.graph).toHaveLength(0);
  });
});
