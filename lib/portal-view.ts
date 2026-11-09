// What the customer portal is allowed to show, and the checks on what a
// customer can send it. The portal reads documents and jobs with the service
// client on the server (SQL 0070 takes away the customer's own write access),
// so everything here builds an allow-listed copy: internal fields such as a
// line's `cost`, `price_book_item_name`, a contract's office `notes` or a
// job's Field Board log never reach a portal page.
// Pure helpers, no I/O.

import type { ContractLineItems } from "@/lib/contract-terms";
import type { TierTotals } from "@/lib/estimate-tier";
import { addDaysToDateKey, etDateAtHour, formatEtDateTime } from "@/lib/tz";

type Raw = Record<string, unknown>;

function obj(value: unknown): Raw {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** One priced line as the customer sees it. No cost, no price book name. */
export type PortalLineItem = {
  category: string;
  description: string;
  qty: number;
  unit: string;
  good: number | null;
  better: number | null;
  best: number | null;
};

export type PortalPricedLines = {
  items: PortalLineItem[];
  brand: { good: string | null; better: string | null; best: string | null };
  mass_save_eligible: boolean;
  mass_save_note: string | null;
  totals: TierTotals;
  pricing_mode?: "tiered" | "flat";
};

/** Estimate, proposal or invoice line items, with every internal field dropped. */
export function portalPricedLines(raw: unknown): PortalPricedLines {
  const data = obj(raw);
  const items = Array.isArray(data.items) ? data.items : [];
  const brand = obj(data.brand);
  const totals = obj(data.totals);
  const mode = data.pricing_mode;
  return {
    items: items.map((entry) => {
      const item = obj(entry);
      return {
        category: str(item.category) ?? "",
        description: str(item.description) ?? "",
        qty: num(item.qty) ?? 0,
        unit: str(item.unit) ?? "",
        good: num(item.good),
        better: num(item.better),
        best: num(item.best),
      };
    }),
    brand: { good: str(brand.good), better: str(brand.better), best: str(brand.best) },
    mass_save_eligible: data.mass_save_eligible === true,
    mass_save_note: str(data.mass_save_note),
    totals: { good: num(totals.good) ?? 0, better: num(totals.better) ?? 0, best: num(totals.best) ?? 0 },
    ...(mode === "flat" || mode === "tiered" ? { pricing_mode: mode } : {}),
  };
}

/** The contract terms the customer reads and signs. Office notes and the source estimate id stay out. */
export type PortalContractTerms = Pick<
  ContractLineItems,
  "scopeOfWork" | "paymentTerms" | "warrantyTerms" | "startDate" | "estimatedCompletion" | "autoRenewPriceCents" | "autoRenewAuthorizedAt"
>;

export function portalContractTerms(raw: unknown): PortalContractTerms {
  const data = obj(raw);
  return {
    scopeOfWork: str(data.scopeOfWork) ?? "",
    paymentTerms: str(data.paymentTerms) ?? "",
    warrantyTerms: str(data.warrantyTerms) ?? "",
    startDate: str(data.startDate),
    estimatedCompletion: str(data.estimatedCompletion),
    autoRenewPriceCents: num(data.autoRenewPriceCents),
    autoRenewAuthorizedAt: str(data.autoRenewAuthorizedAt),
  };
}

export type PortalPmReport = {
  recommendations: string | null;
  failures: { key: string | null; section: string | null; label: string | null; notes: string | null }[];
  summary: { pass: number; fail: number; na: number } | null;
};

/** A filed maintenance checklist: pass/fail counts, failed items and recommendations only. */
export function portalPmReport(raw: unknown): PortalPmReport {
  const data = obj(raw);
  const failures = Array.isArray(data.failures) ? data.failures : [];
  const summary = data.summary && typeof data.summary === "object" ? obj(data.summary) : null;
  return {
    recommendations: str(data.recommendations),
    failures: failures.map((entry) => {
      const item = obj(entry);
      return { key: str(item.key), section: str(item.section), label: str(item.label), notes: str(item.notes) };
    }),
    summary: summary ? { pass: num(summary.pass) ?? 0, fail: num(summary.fail) ?? 0, na: num(summary.na) ?? 0 } : null,
  };
}

const FIELD_BOARD_LINE = "[Field Board ";

/**
 * The note a customer sees on one of their jobs. jobs.notes starts as the
 * customer's own words on a request, but the office, the phone receptionist and
 * the Field Board (which appends "[Field Board ...]" lines) write to it too.
 * So it shows only while the job is still a request, and stops at the first
 * Field Board line.
 */
export function portalJobNote(status: string | null | undefined, notes: string | null | undefined): string | null {
  if (status !== "requested" || !notes) return null;
  const lines: string[] = [];
  for (const line of notes.split("\n")) {
    if (line.trimStart().startsWith(FIELD_BOARD_LINE)) break;
    lines.push(line);
  }
  const text = lines.join("\n").trim();
  return text || null;
}

const STATUS_LABEL: Record<string, string> = {
  requested: "Requested",
  scheduled: "Scheduled",
  in_progress: "In progress",
  complete: "Complete",
  completed: "Complete",
  cancelled: "Cancelled",
  sent: "Sent",
  approved: "Approved",
  signed: "Signed",
  paid: "Paid",
  active: "Active",
  expired: "Expired",
};

/** A friendly label for a job, document or plan status ("in_progress" reads "In progress"). */
export function portalStatusLabel(status: string | null | undefined): string {
  if (!status) return "";
  const known = STATUS_LABEL[status];
  if (known) return known;
  const words = status.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const DATE_STYLE: Record<"short" | "long", Intl.DateTimeFormatOptions> = {
  short: { year: "numeric", month: "numeric", day: "numeric" },
  long: { year: "numeric", month: "long", day: "numeric" },
};

/**
 * A date for the portal. A calendar date ("2026-04-01", e.g. an install date)
 * is shown as that date; a timestamp is shown as its New York date. Null if
 * empty or unreadable.
 */
export function formatPortalDate(value: string | null | undefined, style: "short" | "long" = "short"): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", ...DATE_STYLE[style] });
  }
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return null;
  return formatEtDateTime(when, DATE_STYLE[style]);
}

/** A timestamp as New York date and time, e.g. "11/9/2026, 1:00 PM". Null if empty or unreadable. */
export function formatPortalDateTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return null;
  return formatEtDateTime(when, { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Largest signature the portal stores (a canvas PNG is far smaller). */
export const SIGNATURE_MAX_LENGTH = 500_000;

/**
 * True for what the portal signature pads send: a PNG data URL from the canvas.
 * The signature is shown back as an image on the CRM and PDFs, so anything
 * else (or something huge) is refused.
 */
export function isSignatureImage(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= SIGNATURE_MAX_LENGTH &&
    /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  );
}

/** Start hour (New York) of each preferred window on the Request Service form. */
export const REQUEST_WINDOW_HOURS: Record<string, number> = {
  morning: 8,
  afternoon: 12,
  evening: 16,
};

export const REQUEST_NOTE_MAX = 2000;
export const REQUEST_MAX_DAYS_AHEAD = 365;

export type ServiceRequestInput = { propertyId: string; date: string; window: string; notes: string };

export type ServiceRequestResult =
  | { ok: true; propertyId: string; scheduledAt: Date; notes: string }
  | { ok: false; error: string };

/**
 * Checks a portal service request. The customer only picks one of their own
 * properties, a day, a window and says what is wrong; the server sets
 * everything else on the job. `today` is the New York date (etDateKey()).
 */
export function validateServiceRequest(
  input: ServiceRequestInput,
  ctx: { today: string; propertyIds: readonly string[] }
): ServiceRequestResult {
  const propertyId = input.propertyId.trim();
  const notes = input.notes.trim();
  if (!propertyId) return { ok: false, error: "Please pick the property." };
  if (!ctx.propertyIds.includes(propertyId)) {
    return { ok: false, error: "We couldn't find that property on your account. Refresh the page and pick it again." };
  }
  if (!notes) return { ok: false, error: "Please tell us what you need service for." };
  if (notes.length > REQUEST_NOTE_MAX) {
    return { ok: false, error: `Please keep the description under ${REQUEST_NOTE_MAX.toLocaleString("en-US")} characters.` };
  }
  const hour = REQUEST_WINDOW_HOURS[input.window];
  if (hour === undefined) return { ok: false, error: "Please pick a preferred window." };
  // The window is New York time; the server clock is UTC.
  const scheduledAt = etDateAtHour(input.date, hour);
  if (!scheduledAt) return { ok: false, error: "Please pick a preferred date." };
  if (input.date < ctx.today) return { ok: false, error: "That date has passed. Please pick today or a later day." };
  if (input.date > addDaysToDateKey(ctx.today, REQUEST_MAX_DAYS_AHEAD)) {
    return { ok: false, error: "Please pick a date within the next year." };
  }
  return { ok: true, propertyId, scheduledAt, notes };
}
