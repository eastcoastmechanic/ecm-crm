// Running log (/log): quick notes filed under Texts, Plans, Jobs or Vendors / parts.
// Entries are never deleted; "Fold" tucks one away under the section's Folded list.
// Pure helpers only, so they can be tested without a database.

import { formatEtDate, formatEtShortDateTime } from "./tz";
import type { TeamsChannel } from "./teams";

export const LOG_SECTIONS = ["texts", "plans", "jobs", "vendors"] as const;
export type LogSection = (typeof LOG_SECTIONS)[number];

export const LOG_SECTION_LABEL: Record<LogSection, string> = {
  texts: "Texts",
  plans: "Plans",
  jobs: "Jobs",
  vendors: "Vendors / parts",
};

export const MAX_LOG_LENGTH = 5000;
/** Entries shown per section and state (open or folded) before "Show older". */
export const LOG_PAGE_STEP = 200;
export const LOG_PAGE_MAX = 5000;
export const SUMMARY_LENGTH = 80;

export const LOG_MIGRATION_MESSAGE = "Run SQL 0073 (db/migrations/0073_running_log.sql) in Supabase to turn on the log.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseSection(value: unknown): LogSection | null {
  return typeof value === "string" && (LOG_SECTIONS as readonly string[]).includes(value)
    ? (value as LogSection)
    : null;
}

/** A uuid, or null for blank. Anything else is "bad". */
export function parseOptionalId(value: unknown): string | null | "bad" {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  return UUID.test(text) ? text : "bad";
}

export type LogInput = { section: LogSection; body: string; jobId: string | null; customerId: string | null };

/**
 * Checks what the add box sent. A job link is only kept for the Jobs section and a
 * customer link only for Texts, so a stray hidden value never links the wrong thing.
 */
export function validateLogInput(raw: {
  section: unknown;
  body: unknown;
  jobId?: unknown;
  customerId?: unknown;
}): { error: string } | { value: LogInput } {
  const section = parseSection(raw.section);
  if (!section) return { error: "Pick a section." };
  const body = typeof raw.body === "string" ? raw.body.trim() : "";
  if (!body) return { error: "Write something first." };
  if (body.length > MAX_LOG_LENGTH) return { error: `Keep it under ${MAX_LOG_LENGTH} characters.` };

  const jobId = section === "jobs" ? parseOptionalId(raw.jobId) : null;
  if (jobId === "bad") return { error: "That job couldn't be found. Pick it again." };
  const customerId = section === "texts" ? parseOptionalId(raw.customerId) : null;
  if (customerId === "bad") return { error: "That customer couldn't be found. Pick them again." };

  return { value: { section, body, jobId, customerId } };
}

/** One line for a folded entry: whitespace squashed, cut at ~80 characters. */
export function summaryLine(body: string, max: number = SUMMARY_LENGTH): string {
  const flat = (body ?? "").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}

type Foldable = { folded: boolean; created_at: string };

/** Splits entries into open and folded, each newest first. */
export function groupLogEntries<T extends Foldable>(entries: T[]): { open: T[]; folded: T[] } {
  const newestFirst = [...entries].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return {
    open: newestFirst.filter((e) => !e.folded),
    folded: newestFirst.filter((e) => e.folded),
  };
}

/** The columns to write when folding or unfolding. */
export function foldPatch(folded: boolean, now: Date = new Date()): { folded: boolean; folded_at: string | null } {
  return { folded, folded_at: folded ? now.toISOString() : null };
}

/** True when a Supabase error means SQL 0073 has not been run yet. */
export function isLogTableMissing(message: string | null | undefined): boolean {
  return /log_entries/i.test(message ?? "") && /(does not exist|could not find|schema cache)/i.test(message ?? "");
}

/** How a job reads in the picker and on an entry: "Customer — address · 11/9/2026". Never a raw id. */
export function jobLabel(job: {
  customerName?: string | null;
  address?: string | null;
  scheduledAt?: string | null;
}): string {
  const who = [job.customerName, job.address].filter(Boolean).join(" — ");
  const date = job.scheduledAt ? formatEtDate(job.scheduledAt) : "not scheduled";
  return [who || "Job with no customer", date].join(" · ");
}

/** "?texts=400" style param name for one section's "Show older" link. */
export function limitParam(section: LogSection, state: "open" | "folded"): string {
  return state === "open" ? section : `${section}_folded`;
}

// ---------------------------------------------------------------- Teams

/** Which Teams channel a new entry is posted to. */
export const LOG_TEAMS_CHANNEL: Record<LogSection, TeamsChannel> = {
  plans: "general",
  texts: "leads",
  vendors: "parts",
  jobs: "job_notes",
};

/**
 * The card for a new entry. Only adds post a card; folding never does.
 * `via` names the agent when it was written through one (Teams agent, assistant).
 */
export function buildLogTeamsCard(entry: {
  section: LogSection;
  body: string;
  createdAt: string;
  author: string | null;
  via?: string | null;
  jobId?: string | null;
  jobLabel?: string | null;
  customerName?: string | null;
  baseUrl: string;
}): { title: string; text: string; url: string } {
  const base = entry.baseUrl.replace(/\/$/, "");
  const who = entry.author ?? (entry.via ? `via ${entry.via}` : "Staff");
  const viaNote = entry.author && entry.via ? ` (via ${entry.via})` : "";
  const byline = `${who}${viaNote} · ${formatEtShortDateTime(entry.createdAt)}`;
  const link = entry.jobId
    ? `Job: ${entry.jobLabel ?? "linked job"}`
    : entry.customerName
      ? `Customer: ${entry.customerName}`
      : null;
  return {
    title: `Log · ${LOG_SECTION_LABEL[entry.section]}`,
    text: [entry.body, byline, link].filter(Boolean).join("\n\n"),
    url: entry.jobId ? `${base}/jobs#job-${entry.jobId}` : `${base}/log#log-${entry.section}`,
  };
}

// ---------------------------------------------------------------- assistant tools

/** Section from what someone typed in Teams: "Plans", "text", "Vendors / parts", "parts", "job". */
export function normalizeSectionName(value: unknown): LogSection | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (!v) return null;
  if (/^texts?$/.test(v)) return "texts";
  if (/^plans?$/.test(v)) return "plans";
  if (/^jobs?$/.test(v)) return "jobs";
  if (/^(vendors?|parts?|vendors?\s*[/&,]\s*parts?|vendors? and parts?)$/.test(v)) return "vendors";
  return null;
}

/**
 * add_log_entry tool input. Unlike the page form, a job or customer sent with the
 * wrong section is an error the agent can fix, not something dropped quietly.
 */
export function parseAddLogToolInput(raw: {
  section?: unknown;
  text?: unknown;
  jobId?: unknown;
  customerId?: unknown;
}): { error: string } | { value: LogInput } {
  const section = normalizeSectionName(raw.section);
  if (!section) return { error: "Section must be Texts, Plans, Jobs or Vendors / parts." };
  const hasJob = typeof raw.jobId === "string" && raw.jobId.trim() !== "";
  const hasCustomer = typeof raw.customerId === "string" && raw.customerId.trim() !== "";
  if (hasJob && section !== "jobs") return { error: "Only a Jobs entry can link a job." };
  if (hasCustomer && section !== "texts") return { error: "Only a Texts entry can link a customer." };
  return validateLogInput({ section, body: raw.text, jobId: raw.jobId, customerId: raw.customerId });
}

/** fold/unfold tool input: an id, or a short piece of the text. */
export function parseLogTarget(raw: {
  id?: unknown;
  match?: unknown;
}): { id: string } | { match: string } | { error: string } {
  const id = parseOptionalId(raw.id);
  if (id === "bad") return { error: "That isn't a log entry id. Use list_log to get one, or pass a short piece of the text." };
  if (id) return { id };
  const match = typeof raw.match === "string" ? raw.match.trim() : "";
  if (match.length >= 3) return { match };
  return { error: "Say which entry: its id from list_log, or at least 3 characters of its text." };
}

/** Entries whose text contains `match` (case and spacing ignored). */
export function matchLogEntries<T extends { body: string }>(entries: T[], match: string): T[] {
  const needle = match.replace(/\s+/g, " ").trim().toLowerCase();
  if (!needle) return [];
  return entries.filter((e) => e.body.replace(/\s+/g, " ").toLowerCase().includes(needle));
}

/** One line per entry for the assistant: id, New York time, section, author, text. */
export function logEntryLine(entry: {
  id: string;
  section: LogSection;
  body: string;
  created_at: string;
  folded: boolean;
  author?: string | null;
}): string {
  return [
    `[${entry.id}]`,
    formatEtShortDateTime(entry.created_at),
    `· ${LOG_SECTION_LABEL[entry.section]}`,
    `· ${entry.author ?? "Staff"}:`,
    summaryLine(entry.body, 200),
    entry.folded ? "(folded)" : "",
  ]
    .filter(Boolean)
    .join(" ");
}
