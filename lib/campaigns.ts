// Customer campaigns (issue #65). Pure rules, no database or network, so they
// can be tested. Josh's decisions (2026-11-06): who = no visit in 12+ months,
// plus a seasonal tune-up push; channel = text if allowed, else email; wording
// = Josh writes it; at most one campaign message per customer every 30 days.

import { COMPANY_ADDRESS, COMPANY_NAME, COMPANY_PHONE } from "@/lib/brand";

export const CAMPAIGN_KINDS = ["lapsed", "tuneup_spring", "tuneup_fall"] as const;
export type CampaignKind = (typeof CAMPAIGN_KINDS)[number];

export const CAMPAIGN_LABEL: Record<CampaignKind, string> = {
  lapsed: "No visit in 12+ months",
  tuneup_spring: "Spring AC tune-up",
  tuneup_fall: "Fall heating tune-up",
};

export const CAMPAIGN_GAP_DAYS = 30;
export const LAPSED_MONTHS = 12;
/** Most messages one Send press goes through, so a run stays well inside the server time limit. */
export const MAX_PER_SEND = 150;

export function parseKind(value: unknown): CampaignKind | null {
  return typeof value === "string" && (CAMPAIGN_KINDS as readonly string[]).includes(value)
    ? (value as CampaignKind)
    : null;
}

export type Template = { sms_text: string | null; email_subject: string | null; email_body: string | null };

/** A campaign sends only once Josh has written both the text and the email. */
export function templateReady(t: Template | null | undefined): boolean {
  return !!t?.sms_text?.trim() && !!t?.email_subject?.trim() && !!t?.email_body?.trim();
}

export type CustomerFacts = {
  /** Most recent finished job, or null if none. */
  lastCompletedAt: string | null;
  hasOpenJob: boolean;
  hasActivePlan: boolean;
  /** Most recent campaign message of any kind, or null. */
  lastCampaignAt: string | null;
  /** Phone on file, sms_consent true and not opted out (canText). */
  textable: boolean;
  email: string | null;
  emailOptedOut: boolean;
};

export type Channel = "sms" | "email";
export type Decision = { send: true; channel: Channel } | { send: false; reason: string };

function monthsBefore(now: Date, months: number): Date {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

/** Text if allowed, otherwise email if they have one and haven't unsubscribed. */
export function pickChannel(f: Pick<CustomerFacts, "textable" | "email" | "emailOptedOut">): Channel | null {
  if (f.textable) return "sms";
  if (f.email?.trim() && !f.emailOptedOut) return "email";
  return null;
}

export function decide(kind: CampaignKind, f: CustomerFacts, now: Date = new Date()): Decision {
  if (f.hasActivePlan) return { send: false, reason: "has an active plan" };
  if (f.hasOpenJob) return { send: false, reason: "has an open job" };
  if (kind === "lapsed") {
    if (!f.lastCompletedAt) return { send: false, reason: "no finished job yet" };
    if (new Date(f.lastCompletedAt) > monthsBefore(now, LAPSED_MONTHS)) {
      return { send: false, reason: "visited in the last 12 months" };
    }
  }
  if (f.lastCampaignAt && now.getTime() - new Date(f.lastCampaignAt).getTime() < CAMPAIGN_GAP_DAYS * 86_400_000) {
    return { send: false, reason: "got a campaign message in the last 30 days" };
  }
  const channel = pickChannel(f);
  if (!channel) return { send: false, reason: "no way to reach them (no texting consent, no email)" };
  return { send: true, channel };
}

export const PLACEHOLDERS = "{first_name}, {company}, {phone}";

function firstName(name: string | null): string {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first || "there";
}

/** Fills {first_name}, {company} and {phone}. Anything else in braces is left as typed. */
export function fill(text: string, customerName: string | null): string {
  return text
    .replace(/\{first_name\}/g, firstName(customerName))
    .replace(/\{company\}/g, COMPANY_NAME)
    .replace(/\{phone\}/g, COMPANY_PHONE);
}

/** The text as sent: Josh's wording, plus the opt-out line when it doesn't already say STOP. */
export function smsBody(template: string, customerName: string | null): string {
  const body = fill(template, customerName).trim();
  return /\bstop\b/i.test(body) ? body : `${body} Reply STOP to opt out.`;
}

/** The email as sent: Josh's wording, then the unsubscribe link and the shop address (CAN-SPAM). */
export function emailBody(template: string, customerName: string | null, unsubscribeUrl: string): string {
  return [
    fill(template, customerName).trim(),
    "",
    "--",
    `${COMPANY_NAME}, ${COMPANY_ADDRESS}`,
    `Don't want these emails? Unsubscribe: ${unsubscribeUrl}`,
  ].join("\n");
}

/**
 * The 30-day limit across simultaneous sends: the route records the send
 * first, then counts this customer's sends in the window (including the new
 * one). More than one means another send got there first, so this one stops.
 */
export function withinLimit(sendsInWindowIncludingThis: number | null): boolean {
  return sendsInWindowIncludingThis !== null && sendsInWindowIncludingThis <= 1;
}

// Duplicate customer records (a Square import next to a hand-made record, a
// second booking) share a phone or an email. One person gets one message per
// press, and an email unsubscribe or a text STOP on any record covers them all.
// Texts: canText already refuses a number if any record with it has no consent
// or the number sent STOP. Emails: optedOutEmailKeys below.

/** Last 10 digits, or null when there aren't 10 (not a usable match key). */
export function phoneMatchKey(phone: string | null | undefined): string | null {
  const key = (phone ?? "").replace(/\D/g, "").slice(-10);
  return key.length === 10 ? key : null;
}

/** Trimmed, lowercased email, or null when it isn't one. */
export function emailMatchKey(email: string | null | undefined): string | null {
  const key = (email ?? "").trim().toLowerCase();
  return key.includes("@") ? key : null;
}

export type ContactInfo = { id: string; phone: string | null; email: string | null };

/** "p:" + phone key and "e:" + email key for one record. */
export function contactKeys(c: Pick<ContactInfo, "phone" | "email">): string[] {
  const keys: string[] = [];
  const p = phoneMatchKey(c.phone);
  const e = emailMatchKey(c.email);
  if (p) keys.push(`p:${p}`);
  if (e) keys.push(`e:${e}`);
  return keys;
}

/** Emails that any customer record has unsubscribed, so every record with that email counts as unsubscribed. */
export function optedOutEmailKeys(rows: { email: string | null; email_opt_out_at: string | null }[]): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    const key = emailMatchKey(r.email);
    if (key && r.email_opt_out_at) out.add(key);
  }
  return out;
}

/** For each record, the ids of every record sharing its phone or email (itself included). */
export function sameContactIds(customers: ContactInfo[]): Map<string, string[]> {
  const byKey = new Map<string, string[]>();
  for (const c of customers) {
    for (const k of contactKeys(c)) {
      const ids = byKey.get(k);
      if (ids) ids.push(c.id);
      else byKey.set(k, [c.id]);
    }
  }
  const out = new Map<string, string[]>();
  for (const c of customers) {
    const ids = new Set([c.id]);
    for (const k of contactKeys(c)) for (const id of byKey.get(k) ?? []) ids.add(id);
    out.set(c.id, [...ids]);
  }
  return out;
}

/** Latest campaign message to the record or any record sharing its phone or email, so the 30 days covers duplicates. */
export function lastCampaignForContact(
  groups: Map<string, string[]>,
  lastById: Map<string, string>
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [id, ids] of groups) {
    let last: string | null = null;
    for (const other of ids) {
      const t = lastById.get(other);
      if (t && (!last || t > last)) last = t;
    }
    if (last) out.set(id, last);
  }
  return out;
}

export const DUPLICATE_REASON = "same phone or email as another customer getting this one";

/**
 * One message per person per press. Rows going by text claim first (text is
 * the preferred channel), then email rows, in list order. Once a row is kept,
 * its phone and email are taken, and any later row sharing either is dropped
 * with DUPLICATE_REASON. Rows not going out pass through untouched. Order kept.
 */
export function dedupeRecipients<T extends { customerId: string; channel: Channel | null; reason: string | null }>(
  rows: T[],
  contactOf: (customerId: string) => Pick<ContactInfo, "phone" | "email"> | undefined
): T[] {
  const taken = new Set<string>();
  const dropped = new Set<number>();
  for (const channel of ["sms", "email"] as const) {
    rows.forEach((row, i) => {
      if (row.channel !== channel) return;
      const contact = contactOf(row.customerId);
      const keys = contact ? contactKeys(contact) : [];
      if (keys.some((k) => taken.has(k))) {
        dropped.add(i);
        return;
      }
      for (const k of keys) taken.add(k);
    });
  }
  return rows.map((row, i) => (dropped.has(i) ? { ...row, channel: null, reason: DUPLICATE_REASON } : row));
}
