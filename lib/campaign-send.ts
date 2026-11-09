import { supabase } from "@/lib/supabase";
import { canText } from "@/lib/sms-consent";
import { sendSMS } from "@/lib/sms";
import { resend, RESEND_FROM_EMAIL, RESEND_REPLY_TO } from "@/lib/resend";
import { COMPANY_NAME } from "@/lib/brand";
import { etDateKey } from "@/lib/tz";
import {
  CAMPAIGN_GAP_DAYS,
  decide,
  dedupeRecipients,
  emailMatchKey,
  lastCampaignForContact,
  optedOutEmailKeys,
  sameContactIds,
  fill,
  emailBody,
  MAX_PER_SEND,
  smsBody,
  templateReady,
  withinLimit,
  type CampaignKind,
  type Channel,
  type CustomerFacts,
  type Template,
} from "@/lib/campaigns";

// Server side of campaigns: who's on the list right now, and sending to them.
// The list is always rebuilt from the database here; nothing the browser sends
// decides who gets a message.

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://ecm-crm.vercel.app").replace(/\/$/, "");
const OPEN_STATUSES = ["requested", "scheduled", "in_progress"];
const DONE_STATUSES = ["complete", "completed"];

export type AudienceRow = {
  customerId: string;
  name: string;
  channel: Channel | null;
  reason: string | null;
};

type CustomerRow = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  sms_consent: boolean | null;
  email_opt_out_at: string | null;
  unsubscribe_token: string;
};

const PAGE = 1000;

/**
 * Every row, page by page. Supabase returns at most 1000 rows per request, and
 * a cut-off list here could miss someone's open job or plan and message them
 * anyway. Throws on any error so a partial list never sends.
 */
async function allRows<T>(
  query: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return rows;
  }
}

async function loadFacts() {
  const today = etDateKey();
  const since = new Date(Date.now() - CAMPAIGN_GAP_DAYS * 86_400_000).toISOString();
  const [customers, jobs, plans, sends] = await Promise.all([
    allRows<CustomerRow>((a, b) =>
      supabase
        .from("customers")
        .select("id, name, phone, email, sms_consent, email_opt_out_at, unsubscribe_token")
        .order("id")
        .range(a, b)
    ),
    allRows<{ customer_id: string; status: string; completed_at: string | null }>((a, b) =>
      supabase.from("jobs").select("customer_id, status, completed_at").not("customer_id", "is", null).order("id").range(a, b)
    ),
    allRows<{ customer_id: string; end_date: string | null }>((a, b) =>
      supabase.from("service_contracts").select("customer_id, end_date").eq("status", "active").order("id").range(a, b)
    ),
    allRows<{ customer_id: string; sent_at: string }>((a, b) =>
      supabase.from("campaign_sends").select("customer_id, sent_at").is("error", null).gte("sent_at", since).order("id").range(a, b)
    ),
  ]);
  customers.sort((x, y) => (x.name ?? "").localeCompare(y.name ?? ""));
  const jobsRes = { data: jobs };
  const plansRes = { data: plans };
  const sendsRes = { data: sends };
  const customersRes = { data: customers };

  const lastDone = new Map<string, string>();
  const open = new Set<string>();
  for (const j of jobsRes.data ?? []) {
    const id = j.customer_id as string;
    if (OPEN_STATUSES.includes(j.status as string)) open.add(id);
    if (DONE_STATUSES.includes(j.status as string) && j.completed_at) {
      const prev = lastDone.get(id);
      if (!prev || (j.completed_at as string) > prev) lastDone.set(id, j.completed_at as string);
    }
  }
  const planned = new Set(
    (plansRes.data ?? []).filter((p) => !p.end_date || (p.end_date as string) >= today).map((p) => p.customer_id as string)
  );
  const lastCampaignById = new Map<string, string>();
  for (const s of sendsRes.data ?? []) {
    const id = s.customer_id as string;
    const prev = lastCampaignById.get(id);
    if (!prev || (s.sent_at as string) > prev) lastCampaignById.set(id, s.sent_at as string);
  }
  const allCustomers = (customersRes.data ?? []) as CustomerRow[];
  // Duplicate records (same phone or email) count as one person: the 30 days
  // and an email unsubscribe on any of them cover all of them.
  const sameContact = sameContactIds(allCustomers);
  const lastCampaign = lastCampaignForContact(sameContact, lastCampaignById);
  const optedOutEmails = optedOutEmailKeys(allCustomers);
  return { customers: allCustomers, lastDone, open, planned, lastCampaign, sameContact, optedOutEmails };
}

function emailOptedOut(c: CustomerRow, optedOutEmails: Set<string>): boolean {
  const key = emailMatchKey(c.email);
  return !!c.email_opt_out_at || (!!key && optedOutEmails.has(key));
}

/** Unsubscribed emails across every customer record, read fresh. Throws on a read error. */
async function freshOptedOutEmails(): Promise<Set<string>> {
  const rows = await allRows<{ email: string | null; email_opt_out_at: string | null }>((a, b) =>
    supabase
      .from("customers")
      .select("email, email_opt_out_at")
      .not("email_opt_out_at", "is", null)
      .order("id")
      .range(a, b)
  );
  return optedOutEmailKeys(rows);
}

async function textable(c: CustomerRow): Promise<boolean> {
  return !!c.phone && c.sms_consent === true && (await canText(c.phone));
}

/** Everyone, with whether they'd get this campaign and how, or why not. */
type Facts = Awaited<ReturnType<typeof loadFacts>>;

export async function buildAudience(kind: CampaignKind, loaded?: Facts): Promise<AudienceRow[]> {
  const facts = loaded ?? (await loadFacts());
  const now = new Date();
  const rows: AudienceRow[] = [];
  for (const c of facts.customers) {
    // A duplicate record (same phone or email) is the same person: an open job,
    // active plan or recent visit on any of them counts for this one too.
    const group = facts.sameContact.get(c.id) ?? [c.id];
    let lastCompletedAt: string | null = null;
    for (const id of group) {
      const t = facts.lastDone.get(id);
      if (t && (!lastCompletedAt || t > lastCompletedAt)) lastCompletedAt = t;
    }
    const base: CustomerFacts = {
      lastCompletedAt,
      hasOpenJob: group.some((id) => facts.open.has(id)),
      hasActivePlan: group.some((id) => facts.planned.has(id)),
      lastCampaignAt: facts.lastCampaign.get(c.id) ?? null,
      // Only ask the opt-out tables when the cheaper checks haven't already ruled them out.
      textable: false,
      email: c.email,
      emailOptedOut: emailOptedOut(c, facts.optedOutEmails),
    };
    const decision = decide(kind, base, now);
    // Recheck with real texting permission only for customers who pass everything else.
    if (!decision.send && decision.reason !== "no way to reach them (no texting consent, no email)") {
      rows.push({ customerId: c.id, name: c.name ?? "Unnamed", channel: null, reason: decision.reason });
      continue;
    }
    const final = decide(kind, { ...base, textable: await textable(c) }, now);
    rows.push({
      customerId: c.id,
      name: c.name ?? "Unnamed",
      channel: final.send ? final.channel : null,
      reason: final.send ? null : final.reason,
    });
  }
  // One message per person: duplicate records with the same phone or email drop off.
  const byId = new Map(facts.customers.map((c) => [c.id, c]));
  return dedupeRecipients(rows, (id) => byId.get(id));
}

export type SendResult = { sent: number; failed: number; skipped: number; leftOver: number; errors: string[] };

/**
 * Sends the campaign to everyone on the list now, up to MAX_PER_SEND. Each
 * send is recorded first and counted, so two Send presses at once can't both
 * message the same customer inside 30 days.
 */
export async function sendCampaign(kind: CampaignKind, template: Template): Promise<SendResult> {
  if (!templateReady(template)) throw new Error("Write the text and the email first.");
  const facts = await loadFacts();
  const byId = new Map(facts.customers.map((c) => [c.id, c]));
  const audience = (await buildAudience(kind, facts)).filter((r) => r.channel);
  const batch = audience.slice(0, MAX_PER_SEND);
  const result: SendResult = { sent: 0, failed: 0, skipped: 0, leftOver: audience.length - batch.length, errors: [] };

  for (const row of batch) {
    const c = byId.get(row.customerId);
    if (!c || !row.channel) continue;

    const { data: rec, error: recError } = await supabase
      .from("campaign_sends")
      .insert({ customer_id: c.id, kind, channel: row.channel })
      .select("id")
      .single();
    if (recError || !rec) {
      result.failed++;
      result.errors.push(`${row.name}: couldn't record the send`);
      continue;
    }
    // Counted across every record with the same phone or email, so a duplicate
    // record can't be the way round the 30 days.
    const { count, error: countError } = await supabase
      .from("campaign_sends")
      .select("id", { count: "exact", head: true })
      .in("customer_id", facts.sameContact.get(c.id) ?? [c.id])
      .is("error", null)
      .gte("sent_at", new Date(Date.now() - CAMPAIGN_GAP_DAYS * 86_400_000).toISOString());
    if (!withinLimit(countError ? null : (count ?? 0))) {
      await supabase.from("campaign_sends").delete().eq("id", rec.id);
      result.skipped++;
      continue;
    }

    let error: string | null = null;
    let emailTo: string | null = null;
    if (row.channel === "sms") {
      // Re-check consent right before sending (a STOP may have just come in).
      if (!(await textable(c))) error = "texting not allowed any more";
      else {
        const sent = await sendSMS(c.phone, smsBody(template.sms_text!, c.name));
        if (!sent.ok) error = sent.error ?? "text failed";
      }
    } else {
      // Re-check right before sending: they may have unsubscribed (or changed email) since the list was built.
      const { data: fresh, error: freshError } = await supabase
        .from("customers")
        .select("email, email_opt_out_at")
        .eq("id", c.id)
        .maybeSingle();
      if (freshError || !fresh) error = "couldn't re-check their email settings";
      else if (fresh.email_opt_out_at) error = "unsubscribed since the list was built";
      else if (!fresh.email?.trim()) error = "no email any more";
      else {
        // An unsubscribe on any record with this email covers this one too.
        let optedOut: Set<string> | null = null;
        try {
          optedOut = await freshOptedOutEmails();
        } catch {
          error = "couldn't re-check their email settings";
        }
        if (optedOut) {
          const key = emailMatchKey(fresh.email);
          if (key && optedOut.has(key)) error = "unsubscribed on another record with this email";
          else emailTo = fresh.email.trim();
        }
      }
    }
    if (row.channel === "email" && !error && emailTo) {
      try {
        const { error: mailError } = await resend.emails.send({
          from: `${COMPANY_NAME} <${RESEND_FROM_EMAIL}>`,
          replyTo: RESEND_REPLY_TO,
          to: emailTo,
          subject: fill(template.email_subject!, c.name).trim(),
          text: emailBody(template.email_body!, c.name, `${APP_URL}/unsubscribe/${c.unsubscribe_token}`),
          headers: { "List-Unsubscribe": `<${APP_URL}/unsubscribe/${c.unsubscribe_token}>` },
        });
        if (mailError) error = mailError.message;
      } catch (err) {
        error = err instanceof Error ? err.message : "email failed";
      }
    }

    if (error) {
      // A failed send doesn't count toward the 30 days; keep it on record with the reason.
      await supabase.from("campaign_sends").update({ error: error.slice(0, 300) }).eq("id", rec.id);
      result.failed++;
      result.errors.push(`${row.name}: ${error}`);
    } else {
      result.sent++;
    }
  }
  return result;
}
