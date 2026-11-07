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
