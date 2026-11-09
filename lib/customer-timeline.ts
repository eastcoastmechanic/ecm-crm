// Customer timeline: everything that happened with one customer, newest first.
// Pure merge and formatting only (no database), so it can be tested. The page
// fetches each source table and hands the rows to buildCustomerTimeline().

import { CAMPAIGN_LABEL, type CampaignKind } from "./campaigns";
import { formatEtDate, formatEtShortDateTime, parseEtLocal } from "./tz";

export const TIMELINE_FILTERS = ["all", "texts", "calls", "money", "jobs", "notes"] as const;
export type TimelineFilter = (typeof TIMELINE_FILTERS)[number];
export type TimelineCategory = Exclude<TimelineFilter, "all">;

export const TIMELINE_FILTER_LABEL: Record<TimelineFilter, string> = {
  all: "All",
  texts: "Texts",
  calls: "Calls",
  money: "Money",
  jobs: "Jobs",
  notes: "Notes",
};

/** Items shown per "Show more" press. */
export const TIMELINE_PAGE_STEP = 50;
/** Most items the page will ever ask for in one load. */
export const TIMELINE_PAGE_MAX = 5000;
export const SUMMARY_MAX = 100;

export type TimelineItem = {
  /** Unique and stable, e.g. "doc-sent-<id>". */
  key: string;
  /** Sort instant (ms since epoch). */
  at: number;
  /** New York date (and time, unless the source only has a date). */
  when: string;
  category: TimelineCategory;
  label: string;
  summary: string;
  href: string | null;
};

// Row shapes: only the columns the timeline reads.
type TranscriptEntry = { role?: string; content?: unknown };
export type ConversationRow = {
  id: string;
  channel: string | null;
  created_at: string | null;
  updated_at: string | null;
  transcript: TranscriptEntry[] | null;
};
export type DocumentRow = {
  id: string;
  doc_number: string | null;
  type: string | null;
  status: string | null;
  total: number | string | null;
  created_at: string | null;
  sent_at: string | null;
  signed_at: string | null;
  paid_at: string | null;
  payment_source: string | null;
  deposit_received_cents: number | null;
  deposit_received_at: string | null;
  deposit_method: string | null;
};
export type JobRow = {
  id: string;
  job_type: string | null;
  status: string | null;
  notes: string | null;
  created_via: string | null;
  created_at: string | null;
  scheduled_at: string | null;
  on_way_at: string | null;
  arrived_at: string | null;
  completed_at: string | null;
  review_request_sent_at: string | null;
  review_reminder_sent_at: string | null;
};
export type JobNoteRow = { id: string; job_id: string; author_name: string | null; body: string | null; created_at: string | null };
export type LogEntryRow = { id: string; section: string | null; body: string | null; job_id: string | null; created_at: string | null };
export type SurveyRow = { id: string; job_id: string; rating: number | null; comment: string | null; created_at: string | null };
export type CampaignSendRow = { id: number | string; kind: string | null; channel: string | null; sent_at: string | null; error: string | null };
export type SquarePaymentRow = {
  id: string;
  status: string | null;
  total_cents: number | null;
  source_type: string | null;
  square_created_at: string | null;
};

export type TimelineSources = {
  conversations?: ConversationRow[];
  documents?: DocumentRow[];
  jobs?: JobRow[];
  jobNotes?: JobNoteRow[];
  logEntries?: LogEntryRow[];
  surveys?: SurveyRow[];
  campaignSends?: CampaignSendRow[];
  squarePayments?: SquarePaymentRow[];
};

export type TimelineOptions = {
  /** Owner and office see amounts. Anyone else gets the same items with no money in them. */
  showMoney: boolean;
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Sort instant and New York label for a timestamp, or null when it is missing or
 * unreadable (so a blank never shows up as 1/1/1970). A plain date column
 * ("2026-11-09") has no time: it sorts at noon New York time and prints the date only.
 */
export function timelineWhen(value: string | null | undefined): { at: number; when: string } | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  if (DATE_ONLY.test(text)) {
    const noon = parseEtLocal(`${text}T12:00`);
    if (!noon) return null;
    return { at: noon.getTime(), when: formatEtDate(text) };
  }
  const d = new Date(text);
  const at = d.getTime();
  if (Number.isNaN(at) || at <= 0) return null;
  return { at, when: formatEtShortDateTime(d) };
}

/** First non-blank line of a text, cut to `max` characters. */
export function firstLine(text: unknown, max = SUMMARY_MAX): string {
  if (typeof text !== "string") return "";
  const line = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function dollars(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? usd.format(n) : null;
}

function centsToDollars(cents: number | null | undefined): string | null {
  return typeof cents === "number" && Number.isFinite(cents) ? usd.format(cents / 100) : null;
}

const DOC_TYPE_LABEL: Record<string, string> = {
  estimate: "Estimate",
  invoice: "Invoice",
  contract: "Contract",
  proposal: "Proposal",
  assessment: "Assessment",
  warranty: "Warranty",
  mass_save_rebate: "Mass Save rebate",
  pm_report: "PM report",
};
const MONEY_DOC_TYPES = new Set(["estimate", "invoice", "contract", "proposal"]);

const JOB_TYPE_LABEL: Record<string, string> = {
  install: "Install",
  service: "Service",
  repair: "Repair",
  maintenance: "Maintenance",
  warranty: "Warranty",
};

const CREATED_VIA_LABEL: Record<string, string> = {
  ai_sms: "booked by text receptionist",
  ai_voice: "booked by phone receptionist",
  web_chat: "booked by website chat",
  web_form: "booked on the website form",
  portal: "requested in the customer portal",
  maintenance_plan: "maintenance plan visit",
};

const PAYMENT_SOURCE_LABEL: Record<string, string> = {
  stripe: "card (Stripe)",
  square: "Square",
  manual: "marked paid",
  cash_check: "cash/check",
};

function humanize(value: string | null | undefined): string {
  return (value ?? "").replace(/_/g, " ").trim();
}

function joinParts(parts: (string | null | undefined | false)[]): string {
  return parts.filter((p): p is string => typeof p === "string" && p.length > 0).join(" · ");
}

export function jobHref(jobId: string): string {
  return `/jobs?view=list#job-${jobId}`;
}

function push(
  out: TimelineItem[],
  value: string | null | undefined,
  item: Omit<TimelineItem, "at" | "when">
): void {
  const when = timelineWhen(value);
  if (!when) return;
  out.push({ ...item, ...when });
}

function conversationItems(rows: ConversationRow[], out: TimelineItem[]): void {
  for (const c of rows) {
    const transcript = Array.isArray(c.transcript) ? c.transcript.filter((t) => firstLine(t?.content)) : [];
    const href = `/conversations/${c.id}`;
    const direction = (t: TranscriptEntry | undefined) => (t?.role === "user" ? "in" : "out");

    if (c.channel === "voice") {
      const firstCaller = transcript.find((t) => t.role === "user");
      push(out, c.created_at, {
        key: `conv-${c.id}`,
        category: "calls",
        label: "Phone call",
        summary: joinParts(["Answered by the phone receptionist", firstLine(firstCaller?.content)]),
        href,
      });
      continue;
    }

    if (c.channel === "web") {
      const firstVisitor = transcript.find((t) => t.role === "user");
      push(out, c.created_at, {
        key: `conv-${c.id}`,
        category: "texts",
        label: "Website chat",
        summary: firstLine(firstVisitor?.content) || "Chat started",
        href,
      });
      continue;
    }

    // Text threads keep one row per phone number with no time on each message, so the
    // timeline shows when the thread started and, if it went on later, the latest message.
    const first = transcript[0];
    const last = transcript[transcript.length - 1];
    push(out, c.created_at, {
      key: `conv-${c.id}`,
      category: "texts",
      label: first ? `Text ${direction(first)}` : "Text thread",
      summary: first ? firstLine(first.content) : "Thread started",
      href,
    });
    const start = timelineWhen(c.created_at);
    const latest = timelineWhen(c.updated_at);
    if (last && transcript.length > 1 && latest && (!start || latest.at - start.at >= 60_000)) {
      out.push({
        key: `conv-latest-${c.id}`,
        ...latest,
        category: "texts",
        label: `Text ${direction(last)} (latest)`,
        summary: firstLine(last.content),
        href,
      });
    }
  }
}

function documentItems(rows: DocumentRow[], out: TimelineItem[], showMoney: boolean): void {
  for (const d of rows) {
    const typeLabel = DOC_TYPE_LABEL[d.type ?? ""] ?? (humanize(d.type) || "Document");
    const name = d.doc_number ? `${typeLabel} ${d.doc_number}` : typeLabel;
    const category: TimelineCategory = MONEY_DOC_TYPES.has(d.type ?? "") ? "money" : "jobs";
    const href = `/documents/${d.id}`;
    const total = showMoney ? dollars(d.total) : null;

    push(out, d.created_at, {
      key: `doc-created-${d.id}`,
      category,
      label: `${typeLabel} created`,
      summary: joinParts([name, total, d.status ? `now ${humanize(d.status)}` : null]),
      href,
    });
    push(out, d.sent_at, {
      key: `doc-sent-${d.id}`,
      category,
      label: `${typeLabel} sent`,
      summary: joinParts([name, total]),
      href,
    });
    push(out, d.signed_at, {
      key: `doc-signed-${d.id}`,
      category,
      label: `${typeLabel} signed`,
      summary: joinParts([name, total]),
      href,
    });
    push(out, d.paid_at, {
      key: `doc-paid-${d.id}`,
      category: "money",
      label: `${typeLabel} paid`,
      summary: joinParts([name, total, d.payment_source ? PAYMENT_SOURCE_LABEL[d.payment_source] ?? humanize(d.payment_source) : null]),
      href,
    });
    push(out, d.deposit_received_at, {
      key: `doc-deposit-${d.id}`,
      category: "money",
      label: "Deposit received",
      summary: joinParts([name, showMoney ? centsToDollars(d.deposit_received_cents) : null, humanize(d.deposit_method)]),
      href,
    });
  }
}

function jobItems(rows: JobRow[], out: TimelineItem[]): void {
  for (const j of rows) {
    const jobName = `${JOB_TYPE_LABEL[j.job_type ?? ""] ?? (humanize(j.job_type) || "Job")} job`;
    const href = jobHref(j.id);
    const note = firstLine(j.notes);

    push(out, j.created_at, {
      key: `job-created-${j.id}`,
      category: "jobs",
      label: j.status === "requested" ? `${jobName} requested` : `${jobName} created`,
      summary: joinParts([CREATED_VIA_LABEL[j.created_via ?? ""], note, j.status ? `now ${humanize(j.status)}` : null]) || jobName,
      href,
    });
    push(out, j.scheduled_at, { key: `job-scheduled-${j.id}`, category: "jobs", label: "Scheduled for", summary: joinParts([jobName, note]), href });
    push(out, j.on_way_at, { key: `job-onway-${j.id}`, category: "jobs", label: "Tech on the way", summary: jobName, href });
    push(out, j.arrived_at, { key: `job-arrived-${j.id}`, category: "jobs", label: "On site", summary: jobName, href });
    push(out, j.completed_at, { key: `job-done-${j.id}`, category: "jobs", label: "Job finished", summary: jobName, href });
    push(out, j.review_request_sent_at, {
      key: `job-review-${j.id}`,
      category: "texts",
      label: "Review request texted",
      summary: jobName,
      href,
    });
    push(out, j.review_reminder_sent_at, {
      key: `job-review-reminder-${j.id}`,
      category: "texts",
      label: "Review reminder texted",
      summary: jobName,
      href,
    });
  }
}

/**
 * Merge every source into one list, newest first. Rows with no usable time are
 * left out. Amounts appear only when `showMoney` is true.
 */
export function buildCustomerTimeline(sources: TimelineSources, options: TimelineOptions): TimelineItem[] {
  const out: TimelineItem[] = [];

  conversationItems(sources.conversations ?? [], out);
  documentItems(sources.documents ?? [], out, options.showMoney);
  jobItems(sources.jobs ?? [], out);

  for (const n of sources.jobNotes ?? []) {
    push(out, n.created_at, {
      key: `note-${n.id}`,
      category: "notes",
      label: "Job note",
      summary: joinParts([n.author_name, firstLine(n.body)]),
      href: jobHref(n.job_id),
    });
  }

  const seenLog = new Set<string>();
  for (const e of sources.logEntries ?? []) {
    if (seenLog.has(e.id)) continue;
    seenLog.add(e.id);
    push(out, e.created_at, {
      key: `log-${e.id}`,
      category: "notes",
      label: e.section ? `Log: ${humanize(e.section)}` : "Log",
      summary: firstLine(e.body),
      href: e.job_id ? jobHref(e.job_id) : "/log",
    });
  }

  for (const s of sources.surveys ?? []) {
    push(out, s.created_at, {
      key: `survey-${s.id}`,
      category: "notes",
      label: "Survey answered",
      summary: joinParts([typeof s.rating === "number" ? `${s.rating}/5` : null, firstLine(s.comment)]),
      href: jobHref(s.job_id),
    });
  }

  for (const c of sources.campaignSends ?? []) {
    const kind = CAMPAIGN_LABEL[c.kind as CampaignKind] ?? humanize(c.kind);
    push(out, c.sent_at, {
      key: `campaign-${c.id}`,
      category: "texts",
      label: c.channel === "email" ? "Campaign email" : "Campaign text",
      summary: joinParts([kind, c.error ? `failed: ${firstLine(c.error, 60)}` : null]),
      href: "/campaigns",
    });
  }

  for (const p of sources.squarePayments ?? []) {
    push(out, p.square_created_at, {
      key: `square-${p.id}`,
      category: "money",
      label: "Square payment",
      summary: joinParts([
        options.showMoney ? centsToDollars(p.total_cents) : null,
        humanize(p.source_type).toLowerCase(),
        p.status ? p.status.toLowerCase() : null,
      ]),
      href: "/payments",
    });
  }

  return out.sort((a, b) => b.at - a.at || a.key.localeCompare(b.key));
}

export function parseTimelineFilter(value: string | string[] | undefined): TimelineFilter {
  const v = Array.isArray(value) ? value[0] : value;
  return (TIMELINE_FILTERS as readonly string[]).includes(v ?? "") ? (v as TimelineFilter) : "all";
}

export function filterTimeline(items: TimelineItem[], filter: TimelineFilter): TimelineItem[] {
  return filter === "all" ? items : items.filter((i) => i.category === filter);
}

/** How many items each filter chip would show. */
export function countByFilter(items: TimelineItem[]): Record<TimelineFilter, number> {
  const counts = { all: items.length, texts: 0, calls: 0, money: 0, jobs: 0, notes: 0 };
  for (const i of items) counts[i.category] += 1;
  return counts;
}
