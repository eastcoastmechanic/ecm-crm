import { createHash } from "node:crypto";
import { z } from "zod";
import { addDaysToDateKey } from "@/lib/tz";

/**
 * Daily rundown (Grok's nightly "ECM DAILY RUNDOWN") as structured items, and the
 * owner-only "ECM Daily Rundown" Planner plan they turn into. Pure rules only: the
 * ingest contract, merging a new run into stored items, which bucket and labels a
 * card gets, the card text, and which Planner fields need changing. No database or
 * Graph calls here, so all of it is tested (lib/__tests__/rundown-rules.test.ts).
 */

// ---------------------------------------------------------------- contract

export const RUNDOWN_SECTIONS = ["happened", "money", "waiting", "next", "conflict"] as const;
export type RundownSection = (typeof RUNDOWN_SECTIONS)[number];

export const RUNDOWN_PRIORITIES = ["urgent", "important", "normal"] as const;
export type RundownPriority = (typeof RUNDOWN_PRIORITIES)[number];

/** Where Grok saw it. Only used for the card label (Email, Text, ...). */
export const RUNDOWN_SOURCES = ["board", "quo", "email", "quote", "invoice", "mass_save", "crm", "other"] as const;
export type RundownSource = (typeof RUNDOWN_SOURCES)[number];

export const MAX_ITEMS = 200;
export const TITLE_MAX = 250;
export const DETAIL_MAX = 8_000;
export const SUMMARY_MAX = 20_000;
export const TEXT_BODY_MAX = 1_000;

// Loose UUID shape (any version), same as Postgres accepts.
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "must be a UUID");
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");
export const RUNDOWN_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_.\-/]{0,119}$/;

const textDraftSchema = z.object({
  customer_id: uuid,
  body: z.string().trim().min(1).max(TEXT_BODY_MAX),
});

const itemSchema = z.object({
  key: z.string().regex(RUNDOWN_KEY_PATTERN, "key: 1-120 letters, numbers or : _ . - /"),
  section: z.enum(RUNDOWN_SECTIONS),
  title: z.string().trim().min(1).max(TITLE_MAX),
  detail: z.string().max(DETAIL_MAX).nullish(),
  due: dateKey.nullish(),
  priority: z.enum(RUNDOWN_PRIORITIES).nullish(),
  source: z.enum(RUNDOWN_SOURCES).nullish(),
  job_id: uuid.nullish(),
  lead_id: uuid.nullish(),
  customer_id: uuid.nullish(),
  text_draft: textDraftSchema.nullish(),
});

export const rundownBodySchema = z.object({
  date: dateKey,
  period: z
    .object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) })
    .nullish(),
  summary: z.string().max(SUMMARY_MAX).nullish(),
  items: z.array(itemSchema).max(MAX_ITEMS),
  closed_keys: z.array(z.string().regex(RUNDOWN_KEY_PATTERN)).max(MAX_ITEMS).nullish(),
});

export type RundownBody = z.infer<typeof rundownBodySchema>;
export type RundownInputItem = z.infer<typeof itemSchema>;

/** Validates a POST body. Errors name the field ("items.3.section: ...") so Grok can fix its JSON. */
export function parseRundownBody(raw: unknown): { ok: true; body: RundownBody } | { ok: false; errors: string[] } {
  const result = rundownBodySchema.safeParse(raw);
  if (result.success) return { ok: true, body: result.data };
  return {
    ok: false,
    errors: result.error.issues.slice(0, 20).map((i) => `${i.path.join(".") || "body"}: ${i.message}`),
  };
}

// ---------------------------------------------------------------- stored items

export type RundownStatus = "open" | "done" | "dropped";

/** The fields of a rundown_items row these rules read and write. */
export type RundownItemRow = {
  bot: string;
  key: string;
  section: RundownSection;
  title: string;
  detail: string | null;
  due: string | null;
  priority: RundownPriority;
  source: RundownSource | null;
  job_id: string | null;
  lead_id: string | null;
  customer_id: string | null;
  text_draft: { customer_id: string; body: string } | null;
  status: RundownStatus;
  first_run_date: string;
  last_run_date: string;
  last_seen_at: string;
  last_run_id: string | null;
  needs_push: boolean;
  done_at: string | null;
  done_by: string | null;
  done_source: string | null;
};

const CONTENT_FIELDS = [
  "section",
  "title",
  "detail",
  "due",
  "priority",
  "source",
  "job_id",
  "lead_id",
  "customer_id",
  "text_draft",
] as const;

function contentOf(item: RundownInputItem) {
  return {
    section: item.section,
    title: item.title.trim(),
    detail: item.detail?.trim() || null,
    due: item.due ?? null,
    priority: item.priority ?? "normal",
    source: item.source ?? null,
    job_id: item.job_id?.toLowerCase() ?? null,
    lead_id: item.lead_id?.toLowerCase() ?? null,
    customer_id: item.customer_id?.toLowerCase() ?? null,
    text_draft: item.text_draft
      ? { customer_id: item.text_draft.customer_id.toLowerCase(), body: item.text_draft.body.trim() }
      : null,
  };
}

function sameContent(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return CONTENT_FIELDS.every((f) => JSON.stringify(a[f] ?? null) === JSON.stringify(b[f] ?? null));
}

export type MergeResult = {
  /** Full rows to upsert on (bot, key). */
  rows: RundownItemRow[];
  created: string[];
  updated: string[];
  unchanged: string[];
  /** Keys Grok sent again that are already done or dropped: left alone. */
  alreadyDone: string[];
  closed: string[];
  autoClosed: string[];
  warnings: string[];
};

/** "What happened" cards close on their own once Grok has not repeated them for this many days. */
export const HAPPENED_KEEP_DAYS = 2;

/**
 * Merges one run into the stored items for that bot.
 * - New key: a new open item.
 * - Same key, open: content updated; needs_push only if something on the card changed.
 * - Same key, done or dropped: never reopened (Josh completed it); only last seen moves.
 * - Keys Grok stops sending stay open (nothing is deleted).
 * - closed_keys: open items Grok says are finished are marked done by the bot.
 * - "What happened" items not repeated for HAPPENED_KEEP_DAYS days close on their own.
 */
export function mergeRun(input: {
  bot: string;
  body: RundownBody;
  runId: string | null;
  now: string;
  existing: RundownItemRow[];
  /** Open "happened" items for this bot not in this run (to close the old ones). */
  openHappened?: RundownItemRow[];
}): MergeResult {
  const { bot, body, runId, now } = input;
  const byKey = new Map(input.existing.map((r) => [r.key, r]));
  const out: MergeResult = {
    rows: [],
    created: [],
    updated: [],
    unchanged: [],
    alreadyDone: [],
    closed: [],
    autoClosed: [],
    warnings: [],
  };

  // Same key twice in one run: the last one wins.
  const latest = new Map<string, RundownInputItem>();
  for (const item of body.items) {
    if (latest.has(item.key)) out.warnings.push(`key ${item.key} sent more than once; used the last one`);
    latest.set(item.key, item);
  }
  const closedKeys = new Set(body.closed_keys ?? []);

  for (const [key, item] of latest) {
    const content = contentOf(item);
    const prev = byKey.get(key);
    if (!prev) {
      out.created.push(key);
      out.rows.push({
        bot,
        key,
        ...content,
        status: "open",
        first_run_date: body.date,
        last_run_date: body.date,
        last_seen_at: now,
        last_run_id: runId,
        needs_push: true,
        done_at: null,
        done_by: null,
        done_source: null,
      });
      continue;
    }
    const seen = {
      last_run_date: prev.last_run_date > body.date ? prev.last_run_date : body.date,
      last_seen_at: now,
      last_run_id: runId,
    };
    if (prev.status !== "open") {
      out.alreadyDone.push(key);
      out.rows.push({ ...prev, ...seen });
      continue;
    }
    if (sameContent(prev, content)) {
      out.unchanged.push(key);
      out.rows.push({ ...prev, ...seen });
    } else {
      out.updated.push(key);
      out.rows.push({ ...prev, ...content, ...seen, needs_push: true });
    }
  }

  const rowsByKey = new Map(out.rows.map((r) => [r.key, r]));
  const close = (row: RundownItemRow, source: "grok" | "auto", list: string[]) => {
    const closedRow: RundownItemRow = {
      ...row,
      status: "done",
      done_at: now,
      done_by: source === "grok" ? `bot:${bot}` : "auto",
      done_source: source,
      needs_push: true,
    };
    rowsByKey.set(row.key, closedRow);
    list.push(row.key);
  };

  for (const key of closedKeys) {
    const row = rowsByKey.get(key) ?? byKey.get(key);
    if (!row) {
      out.warnings.push(`closed key ${key} not found`);
      continue;
    }
    if (row.status !== "open") continue;
    close(row, "grok", out.closed);
  }

  const cutoff = addDaysToDateKey(body.date, -HAPPENED_KEEP_DAYS);
  for (const row of input.openHappened ?? []) {
    if (rowsByKey.has(row.key) || row.status !== "open" || row.section !== "happened") continue;
    if (row.last_run_date <= cutoff) close(row, "auto", out.autoClosed);
  }

  out.rows = [...rowsByKey.values()];
  return out;
}

// ---------------------------------------------------------------- the plan

/** Buckets left to right. Completed cards drop into each bucket's own "Completed" list in Planner. */
export const RUNDOWN_BUCKETS = [
  { id: "waiting", name: "Waiting on me" },
  { id: "texts", name: "Texts to approve" },
  { id: "money", name: "Money / admin" },
  { id: "next", name: "Next actions" },
  { id: "conflict", name: "Conflicts" },
  { id: "happened", name: "What happened" },
] as const;
export type RundownBucketId = (typeof RUNDOWN_BUCKETS)[number]["id"];

/**
 * Fixed label slots on the new plan (the CRM makes the plan, so it owns all 25 slots).
 * Planner colours by slot: 1 pink, 2 red, 3 yellow, 4 green, 5 blue, 6 purple, 7 bronze.
 */
export const RUNDOWN_LABELS = {
  urgent: { slot: "category2", name: "Urgent" },
  important: { slot: "category3", name: "Important" },
  job: { slot: "category4", name: "Job" },
  lead: { slot: "category5", name: "Lead" },
  text: { slot: "category6", name: "Text" },
  email: { slot: "category1", name: "Email" },
  money: { slot: "category7", name: "Money" },
} as const;

/** categoryDescriptions to PATCH onto the plan details once, at setup. */
export function planLabelNames(): Record<string, string> {
  return Object.fromEntries(Object.values(RUNDOWN_LABELS).map((l) => [l.slot, l.name]));
}

export function bucketFor(item: Pick<RundownItemRow, "section" | "text_draft">): RundownBucketId {
  if (item.text_draft) return "texts";
  return item.section;
}

export function labelSlotsFor(
  item: Pick<RundownItemRow, "priority" | "job_id" | "lead_id" | "text_draft" | "section" | "source">
): string[] {
  const slots: string[] = [];
  if (item.priority === "urgent") slots.push(RUNDOWN_LABELS.urgent.slot);
  if (item.priority === "important") slots.push(RUNDOWN_LABELS.important.slot);
  if (item.job_id) slots.push(RUNDOWN_LABELS.job.slot);
  if (item.lead_id) slots.push(RUNDOWN_LABELS.lead.slot);
  if (item.text_draft) slots.push(RUNDOWN_LABELS.text.slot);
  if (item.source === "email") slots.push(RUNDOWN_LABELS.email.slot);
  if (item.section === "money") slots.push(RUNDOWN_LABELS.money.slot);
  return slots.sort();
}

export const TEXT_DRAFT_START = "----- TEXT DRAFT (edit the wording between these lines) -----";
export const TEXT_DRAFT_END = "----- END TEXT DRAFT -----";
export const DESCRIPTION_MAX = 25_000;

/** The draft wording from a card description, or null when the markers are gone. For the later send step. */
export function readTextDraft(description: string | null | undefined): string | null {
  const text = description ?? "";
  const start = text.indexOf(TEXT_DRAFT_START);
  const end = text.indexOf(TEXT_DRAFT_END, start + TEXT_DRAFT_START.length);
  if (start < 0 || end < 0) return null;
  const body = text.slice(start + TEXT_DRAFT_START.length, end).trim();
  return body || null;
}

/** Card notes: the detail, the text draft (clearly marked), CRM links, and the item key. */
export function cardDescription(item: RundownItemRow, appUrl: string): string {
  const base = appUrl.replace(/\/$/, "");
  const parts: string[] = [];
  if (item.detail) parts.push(item.detail);
  if (item.text_draft) {
    parts.push(
      [
        TEXT_DRAFT_START,
        item.text_draft.body,
        TEXT_DRAFT_END,
        "Not sent yet. Sending from this card comes in a later update; for now text from Quo yourself.",
      ].join("\n")
    );
  }
  const links: string[] = [];
  if (item.job_id) links.push(`Job: ${base}/jobs?view=list#job-${item.job_id}`);
  if (item.lead_id) links.push(`Lead: ${base}/leads`);
  const customerId = item.customer_id ?? item.text_draft?.customer_id ?? null;
  if (customerId) links.push(`Customer: ${base}/customers/${customerId}`);
  if (links.length > 0) parts.push(links.join("\n"));
  parts.push(`Rundown item: ${item.bot}/${item.key} (first seen ${item.first_run_date})`);
  const text = parts.join("\n\n");
  return text.length > DESCRIPTION_MAX ? `${text.slice(0, DESCRIPTION_MAX - 1)}…` : text;
}

export function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

/** What a card should look like right now. */
export type DesiredCard = {
  title: string;
  bucket: RundownBucketId;
  due: string | null;
  labels: string[];
  description: string;
  complete: boolean;
};

export function desiredCard(item: RundownItemRow, appUrl: string): DesiredCard {
  return {
    title: item.title.slice(0, TITLE_MAX),
    bucket: bucketFor(item),
    due: item.due,
    labels: labelSlotsFor(item),
    description: cardDescription(item, appUrl),
    complete: item.status !== "open",
  };
}

/** What the CRM last wrote to the card (stored in rundown_items.planner_pushed). */
export type PushedCard = {
  title: string;
  bucket: RundownBucketId;
  due: string | null;
  labels: string[];
  descHash: string;
  complete: boolean;
};

export function pushedFrom(card: DesiredCard): PushedCard {
  return {
    title: card.title,
    bucket: card.bucket,
    due: card.due,
    labels: card.labels,
    descHash: sha(card.description),
    complete: card.complete,
  };
}

export type CardChanges = {
  title?: string;
  bucket?: RundownBucketId;
  /** null clears the due date. */
  due?: string | null;
  /** slot -> on/off, only the slots that change. */
  labels?: Record<string, boolean>;
  description?: string;
  complete?: true;
};

/**
 * Which fields to send. Only what changed since the CRM's last write, so a card Josh
 * moved, re-dated or relabelled by hand stays where he put it until Grok changes that
 * field. The description is not rewritten if Josh edited it in Planner (his wording
 * on a text draft wins). A card is never reopened: complete is only ever set, never cleared.
 */
export function cardChanges(
  desired: DesiredCard,
  pushed: PushedCard | null,
  currentDescHash: string | null = null
): CardChanges {
  const prev: PushedCard = pushed ?? {
    title: "",
    bucket: desired.bucket,
    due: null,
    labels: [],
    descHash: "",
    complete: false,
  };
  const out: CardChanges = {};
  if (desired.title !== prev.title) out.title = desired.title;
  if (pushed && desired.bucket !== prev.bucket) out.bucket = desired.bucket;
  if ((desired.due ?? null) !== (prev.due ?? null)) out.due = desired.due ?? null;
  const labelDiff: Record<string, boolean> = {};
  for (const slot of desired.labels) if (!prev.labels.includes(slot)) labelDiff[slot] = true;
  for (const slot of prev.labels) if (!desired.labels.includes(slot)) labelDiff[slot] = false;
  if (Object.keys(labelDiff).length > 0) out.labels = labelDiff;
  const descHash = sha(desired.description);
  const joshEdited = pushed !== null && currentDescHash !== null && currentDescHash !== prev.descHash;
  if (descHash !== prev.descHash && !joshEdited) out.description = desired.description;
  if (desired.complete && !prev.complete) out.complete = true;
  return out;
}

/** The pushed record after a successful write: desired values, except a description Josh edited stays his. */
export function pushedAfter(desired: DesiredCard, pushed: PushedCard | null, changes: CardChanges): PushedCard {
  const next = pushedFrom(desired);
  if (pushed && changes.description === undefined && sha(desired.description) !== pushed.descHash) {
    // Josh's edit kept: remember our last text so a later Grok change is still compared fairly.
    next.descHash = pushed.descHash;
  }
  if (pushed?.complete) next.complete = true;
  return next;
}

/** A Planner task's completion, read back from the plan's task list. */
export type PlannerTaskState = {
  percentComplete: number;
  completedDateTime: string | null;
  completedBy: string | null;
};

/**
 * What a pulled Planner state means for an open item: "done" when Josh completed the
 * card, "dropped" when the card is gone from the plan (deleted), else nothing.
 * Only call with a task list that was read in full.
 */
export function pulledStatus(
  item: Pick<RundownItemRow, "status"> & { planner_task_id: string | null },
  tasks: Map<string, PlannerTaskState>
): { status: "done"; doneAt: string | null; doneBy: string | null } | { status: "dropped" } | null {
  if (item.status !== "open" || !item.planner_task_id) return null;
  const task = tasks.get(item.planner_task_id);
  if (!task) return { status: "dropped" };
  if (task.percentComplete >= 100) {
    return { status: "done", doneAt: task.completedDateTime, doneBy: task.completedBy };
  }
  return null;
}
