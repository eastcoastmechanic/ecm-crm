/**
 * Pure rules for what the CRM writes on its Planner cards (the "Jobs" plan):
 * which bucket a job step lands in, the dated New York line each step adds to
 * the card's notes, lead card titles and notes, and which Planner labels a
 * card gets. No Graph or database calls here, so it is all unit tested.
 *
 * Techs can open Planner in Teams, so nothing here ever prints a money amount,
 * and a lead card says only whether a phone or email is on file, not the number.
 */
import { BUSINESS_TZ, formatEtDateTime } from "@/lib/tz";

export type PlannerBucketName = "tasks" | "jobs" | "in_progress" | "needs_attention" | "finished" | "billed";

/** The steps of a job that leave a line on its card. */
export type JobStep =
  | "requested"
  | "scheduled"
  | "rescheduled"
  | "on_way"
  | "on_site"
  | "paused"
  | "finished"
  | "invoice_created"
  | "invoice_sent"
  | "paid"
  | "cancelled";

/**
 * Where each step moves the card. null leaves it where it is:
 *  - rescheduled: a job already under way must not jump back to Jobs because its time moved.
 *  - paused: the job is still in progress.
 *  - invoice created / sent: the work is finished and the money is not in yet, so it stays in
 *    Finished (or Needs Attention) until it is paid; paid moves it to Billed.
 *  - cancelled: the card is marked complete instead of moved.
 * "finished" is a placeholder: a finished job with no service report goes to Needs Attention
 * (unchanged from before), see finishedBucket.
 */
export const STEP_BUCKET: Record<JobStep, PlannerBucketName | null> = {
  requested: "jobs",
  scheduled: "jobs",
  rescheduled: null,
  on_way: "in_progress",
  on_site: "in_progress",
  paused: null,
  finished: "finished",
  invoice_created: null,
  invoice_sent: null,
  paid: "billed",
  cancelled: null,
};

/** A finished job with no service report yet is the "flagged" case Needs Attention is for. */
export function finishedBucket(hasServiceReport: boolean): PlannerBucketName {
  return hasServiceReport ? "finished" : "needs_attention";
}

/** The step a job status change stands for, or null for a status with no step. */
export function statusToStep(status: string): JobStep | null {
  switch (status) {
    case "requested":
      return "requested";
    case "scheduled":
      return "scheduled";
    case "in_progress":
      return "on_site";
    case "complete":
    case "completed":
      return "finished";
    case "cancelled":
    case "canceled":
      return "cancelled";
    default:
      return null;
  }
}

/** Steps that may make the job's card when it has none. Invoice steps never do (as before). */
export function stepCreatesCard(step: JobStep): boolean {
  return !["invoice_created", "invoice_sent", "paid", "paused", "rescheduled"].includes(step);
}

/** Short text for a step: "On the way (Mike)", "Scheduled for Tue 11/10 9:00 AM". No money, ever. */
export function stepText(
  step: JobStep,
  opts: { tech?: string | null; scheduledAt?: string | null; docNumber?: string | null; source?: string | null } = {}
): string {
  const who = opts.tech ? ` (${opts.tech})` : "";
  const when = opts.scheduledAt ? shortWhen(opts.scheduledAt) : null;
  const doc = opts.docNumber ? ` ${opts.docNumber}` : "";
  switch (step) {
    case "requested":
      return `Requested${opts.source ? ` from ${opts.source}` : ""}${when ? `, asked for ${when}` : ""}`;
    case "scheduled":
      return `Scheduled${when ? ` for ${when}` : ""}${who}`;
    case "rescheduled":
      return `Moved${when ? ` to ${when}` : ""}${who}`;
    case "on_way":
      return `On the way${who}`;
    case "on_site":
      return `On site${who}`;
    case "paused":
      return `Paused${who}`;
    case "finished":
      return `Finished${who}`;
    case "invoice_created":
      return `Invoice${doc} created`;
    case "invoice_sent":
      return `Invoice${doc} sent`;
    case "paid":
      return `Invoice${doc} paid`;
    case "cancelled":
      return "Cancelled";
  }
}

/** "Tue 11/10 9:00 AM" in New York time. */
export function shortWhen(at: Date | string): string {
  return formatEtDateTime(at, { weekday: "short", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }).replace(
    /,/g,
    ""
  );
}

/** "11/9 2:15 PM" in New York time, the stamp at the start of every log line. */
export function lineStamp(at: Date | string): string {
  return new Date(at)
    .toLocaleString("en-US", { timeZone: BUSINESS_TZ, month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })
    .replace(",", "");
}

/** One dated log line: "11/9 2:15 PM: On the way (Mike)". Kept to one short line. */
export function stepLine(at: Date | string, text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim().slice(0, 200);
  return `${lineStamp(at)}: ${oneLine}`;
}

const LOG_LINE = /^\d{1,2}\/\d{1,2} \d{1,2}:\d{2}\s?[AP]M: /;

/** Planner caps a card's notes near 32,000 characters; stay well under it. */
export const NOTES_MAX = 30_000;

/**
 * Add a line to the end of a card's notes. When the notes get too long, the oldest
 * dated log lines go first, so the header (lead details) stays; only if that is still
 * too long is the front cut.
 */
export function appendNoteLine(notes: string | null | undefined, line: string, max = NOTES_MAX): string {
  const base = (notes ?? "").replace(/\s+$/, "");
  let lines = base ? [...base.split("\n"), line] : [line];
  let text = lines.join("\n");
  while (text.length > max) {
    const oldest = lines.findIndex((l, i) => i < lines.length - 1 && LOG_LINE.test(l));
    if (oldest === -1) break;
    lines = [...lines.slice(0, oldest), ...lines.slice(oldest + 1)];
    text = lines.join("\n");
  }
  return text.length > max ? text.slice(text.length - max) : text;
}

// ---------------------------------------------------------------- labels

export const LEAD_LABEL = "Lead";

/** Planner label for a leads-table source. */
export function leadSourceLabel(source: string | null | undefined): string {
  switch (source) {
    case "manual":
      return "Manual";
    case "web_search":
      return "Web search";
    case "missed_contact":
      return "Phone";
    case "aging_equipment":
      return "Old equipment";
    case "mls_import":
      return "MLS";
    case "referral":
      return "Referral";
    default:
      return "Other";
  }
}

/**
 * Planner label for how a requested job came in (jobs.created_via), or null for jobs the
 * office made (those are not leads).
 */
export function jobSourceLabel(createdVia: string | null | undefined): string | null {
  switch (createdVia) {
    case "web_form":
      return "Website";
    case "web_chat":
      return "Chat";
    case "portal":
      return "Portal";
    case "ai_voice":
      return "Phone";
    case "ai_sms":
      return "Text";
    default:
      return null;
  }
}

/** Planner's label slots: category1 to category25. */
export const CATEGORY_SLOTS = Array.from({ length: 25 }, (_, i) => `category${i + 1}`);

/**
 * Match label names to the plan's existing label slots (case does not matter), and pick
 * free slots for the names that have none. A free slot has no name AND is on no card, so
 * a colour someone already uses without a name is never taken over, and a named slot is
 * never renamed.
 */
export function planCategories(
  descriptions: Record<string, string | null | undefined>,
  usedSlots: Set<string>,
  names: string[]
): { applied: string[]; newNames: Record<string, string> } {
  const applied: string[] = [];
  const newNames: Record<string, string> = {};
  const taken = new Set<string>();
  for (const slot of CATEGORY_SLOTS) if ((descriptions[slot] ?? "").trim() || usedSlots.has(slot)) taken.add(slot);

  for (const name of [...new Set(names.filter(Boolean))]) {
    const existing = CATEGORY_SLOTS.find((s) => (descriptions[s] ?? "").trim().toLowerCase() === name.toLowerCase());
    if (existing) {
      applied.push(existing);
      continue;
    }
    const free = CATEGORY_SLOTS.find((s) => !taken.has(s));
    if (!free) continue; // all 25 in use: the card just goes without this label
    taken.add(free);
    newNames[free] = name;
    applied.push(free);
  }
  return { applied, newNames };
}

/** Names that still need a slot (for skipping the slow free-slot lookup when every label exists). */
export function missingCategoryNames(descriptions: Record<string, string | null | undefined>, names: string[]): string[] {
  const have = new Set(CATEGORY_SLOTS.map((s) => (descriptions[s] ?? "").trim().toLowerCase()).filter(Boolean));
  return [...new Set(names.filter(Boolean))].filter((n) => !have.has(n.toLowerCase()));
}

// ---------------------------------------------------------------- lead cards

/** A few words of what they need, for a card title. */
export function shortNeed(text: string | null | undefined, max = 50): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 20 ? cut.slice(0, lastSpace) : cut).replace(/[,.;:\s]+$/, "")}…`;
}

/** "Lead: Jane Smith — no heat". Planner titles are capped at 255 characters. */
export function leadCardTitle(name: string | null | undefined, need: string | null | undefined): string {
  const who = (name ?? "").trim() || "New lead";
  const what = shortNeed(need);
  return `Lead: ${who}${what ? ` — ${what}` : ""}`.slice(0, 250);
}

export type LeadCardInput = {
  source: string | null | undefined;
  phone: string | null | undefined;
  email: string | null | undefined;
  address: string | null | undefined;
  town: string | null | undefined;
  message: string | null | undefined;
  crmUrl: string;
};

/** The lead card's notes: where it came from, what is on file, the message, and the CRM link. */
export function leadCardNotes(lead: LeadCardInput): string {
  const where = [lead.address, lead.town].map((s) => (s ?? "").trim()).filter(Boolean);
  const unique = where.filter((s, i) => where.findIndex((o) => o.toLowerCase() === s.toLowerCase()) === i);
  const message = (lead.message ?? "").trim().slice(0, 2000);
  return [
    `Source: ${leadSourceLabel(lead.source)}`,
    `Phone: ${lead.phone?.trim() ? "on file" : "none"}`,
    `Email: ${lead.email?.trim() ? "on file" : "none"}`,
    `Address: ${unique.length ? unique.join(", ") : "not given"}`,
    `Message: ${message || "none"}`,
    `Open in CRM: ${lead.crmUrl}`,
  ].join("\n");
}

const LEAD_STAGE_TEXT: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
  sent: "Message sent",
  dismissed: "Dismissed",
};

export function leadStageText(status: string): string {
  return `Stage: ${LEAD_STAGE_TEXT[status] ?? status}`;
}

/** A lead card is done when the lead is won, lost or dismissed; any other stage reopens it. */
export function leadStageClosesCard(status: string): boolean {
  return status === "won" || status === "lost" || status === "dismissed";
}
