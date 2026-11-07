import { supabase } from "@/lib/supabase";
import { canText } from "@/lib/sms-consent";
import { sendSMS } from "@/lib/sms";
import { resend, RESEND_FROM_EMAIL, RESEND_REPLY_TO } from "@/lib/resend";
import { COMPANY_NAME } from "@/lib/brand";
import { etDateKey } from "@/lib/tz";
import {
  CAMPAIGN_GAP_DAYS,
  decide,
  emailBody,
  MAX_PER_SEND,
  smsBody,
  templateReady,
  withinLimit,
  type CampaignKind,
  type Channel,
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

async function loadFacts() {
  const today = etDateKey();
  const [customersRes, jobsRes, plansRes, sendsRes] = await Promise.all([
    supabase
      .from("customers")
      .select("id, name, phone, email, sms_consent, email_opt_out_at, unsubscribe_token")
      .order("name"),
    supabase.from("jobs").select("customer_id, status, completed_at").not("customer_id", "is", null),
    supabase.from("service_contracts").select("customer_id, status, end_date").eq("status", "active"),
    supabase
      .from("campaign_sends")
      .select("customer_id, sent_at")
      .is("error", null)
      .gte("sent_at", new Date(Date.now() - CAMPAIGN_GAP_DAYS * 86_400_000).toISOString()),
  ]);
  const error = customersRes.error ?? jobsRes.error ?? plansRes.error ?? sendsRes.error;
  if (error) throw new Error(error.message);

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
  const lastCampaign = new Map<string, string>();
  for (const s of sendsRes.data ?? []) {
    const id = s.customer_id as string;
    const prev = lastCampaign.get(id);
    if (!prev || (s.sent_at as string) > prev) lastCampaign.set(id, s.sent_at as string);
  }
  return { customers: (customersRes.data ?? []) as CustomerRow[], lastDone, open, planned, lastCampaign };
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
    const decision = decide(
      kind,
      {
        lastCompletedAt: facts.lastDone.get(c.id) ?? null,
        hasOpenJob: facts.open.has(c.id),
        hasActivePlan: facts.planned.has(c.id),
        lastCampaignAt: facts.lastCampaign.get(c.id) ?? null,
        // Only ask the opt-out tables when the cheaper checks haven't already ruled them out.
        textable: false,
        email: c.email,
        emailOptedOut: !!c.email_opt_out_at,
      },
      now
    );
    // Recheck with real texting permission only for customers who pass everything else.
    if (!decision.send && decision.reason !== "no way to reach them (no texting consent, no email)") {
      rows.push({ customerId: c.id, name: c.name ?? "Unnamed", channel: null, reason: decision.reason });
      continue;
    }
    const final = decide(
      kind,
      {
        lastCompletedAt: facts.lastDone.get(c.id) ?? null,
        hasOpenJob: facts.open.has(c.id),
        hasActivePlan: facts.planned.has(c.id),
        lastCampaignAt: facts.lastCampaign.get(c.id) ?? null,
        textable: await textable(c),
        email: c.email,
        emailOptedOut: !!c.email_opt_out_at,
      },
      now
    );
    rows.push({
      customerId: c.id,
      name: c.name ?? "Unnamed",
      channel: final.send ? final.channel : null,
      reason: final.send ? null : final.reason,
    });
  }
  return rows;
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
    const { count, error: countError } = await supabase
      .from("campaign_sends")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", c.id)
      .is("error", null)
      .gte("sent_at", new Date(Date.now() - CAMPAIGN_GAP_DAYS * 86_400_000).toISOString());
    if (!withinLimit(countError ? null : (count ?? 0))) {
      await supabase.from("campaign_sends").delete().eq("id", rec.id);
      result.skipped++;
      continue;
    }

    let error: string | null = null;
    if (row.channel === "sms") {
      // Re-check consent right before sending (a STOP may have just come in).
      if (!(await textable(c))) error = "texting not allowed any more";
      else {
        const sent = await sendSMS(c.phone, smsBody(template.sms_text!, c.name));
        if (!sent.ok) error = sent.error ?? "text failed";
      }
    } else {
      try {
        const { error: mailError } = await resend.emails.send({
          from: `${COMPANY_NAME} <${RESEND_FROM_EMAIL}>`,
          replyTo: RESEND_REPLY_TO,
          to: c.email!,
          subject: template.email_subject!.trim(),
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
