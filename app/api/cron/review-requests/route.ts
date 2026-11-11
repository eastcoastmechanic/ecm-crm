import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { supabase } from "@/lib/supabase";
import { sendSMS } from "@/lib/sms";
import { canText } from "@/lib/sms-consent";
import { one } from "@/lib/appointment-reminder";
import { nextReviewText, reviewTextCopy, reviewTriggerAt, LOOKBACK_DAYS, type InvoiceRow } from "@/lib/review-requests";
import { skipsPostJobFollowUps } from "@/lib/post-job-followups";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://ecm-crm.vercel.app";
const CHUNK = 100;

type Customer = {
  name: string | null;
  phone: string | null;
  sms_consent: boolean | null;
  no_followups: boolean | null;
};

async function inChunks<T>(ids: string[], load: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await load(ids.slice(i, i + CHUNK))));
  return out;
}

// Daily, midday New York time (see vercel.json). Texts a finished job's customer a link to the survey
// page once the invoice is paid (or a day after finishing, if nothing was invoiced in the CRM), then one
// reminder 5 days later. Stops once they answer. Text only, and only to customers with sms_consent.
// customers.no_followups skips both the ask and the reminder. Scheduling texts are a different cron.
export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  // Paid can come well after finishing, so look further back than the ask window itself.
  const since = new Date(now.getTime() - (LOOKBACK_DAYS + 60) * 24 * 60 * 60 * 1000).toISOString();

  const { data: jobs, error } = await supabase
    .from("jobs")
    .select(
      "id, completed_at, follow_up_sent_at, review_request_sent_at, review_reminder_sent_at, customers(name, phone, sms_consent, no_followups)"
    )
    .in("status", ["complete", "completed"])
    .gte("completed_at", since)
    .is("review_reminder_sent_at", null)
    .limit(1000);
  if (error) return NextResponse.json({ sent: 0, errors: [error.message] });

  const ids = (jobs ?? []).map((j) => j.id as string);
  const errors: string[] = [];
  let sent = 0;
  let skipped = 0;
  if (ids.length === 0) return NextResponse.json({ sent, skipped, errors });

  let invoiceRows: { job_id: string; status: string | null; paid_at: string | null; sent_at: string | null }[];
  let answeredRows: { job_id: string }[];
  try {
    invoiceRows = await inChunks(ids, async (chunk) => {
      const { data, error: e } = await supabase
        .from("documents")
        .select("job_id, status, paid_at, sent_at")
        .eq("type", "invoice")
        .in("job_id", chunk);
      if (e) throw new Error(e.message);
      return (data ?? []) as { job_id: string; status: string | null; paid_at: string | null; sent_at: string | null }[];
    });
    answeredRows = await inChunks(ids, async (chunk) => {
      const { data, error: e } = await supabase.from("satisfaction_surveys").select("job_id").in("job_id", chunk);
      if (e) throw new Error(e.message);
      return (data ?? []) as { job_id: string }[];
    });
  } catch (err) {
    // Without the invoice and survey picture we could text the wrong people. Send nothing.
    return NextResponse.json({ sent: 0, errors: [err instanceof Error ? err.message : "lookup failed"] });
  }

  const invoicesByJob = new Map<string, InvoiceRow[]>();
  for (const r of invoiceRows) {
    const list = invoicesByJob.get(r.job_id) ?? [];
    list.push({ status: r.status, paid_at: r.paid_at, sent_at: r.sent_at });
    invoicesByJob.set(r.job_id, list);
  }
  const answered = new Set(answeredRows.map((r) => r.job_id));

  for (const job of jobs ?? []) {
    const jobId = job.id as string;
    const kind = nextReviewText({
      triggerAt: reviewTriggerAt({
        completedAt: job.completed_at as string | null,
        invoices: invoicesByJob.get(jobId) ?? [],
      }),
      requestSentAt: job.review_request_sent_at as string | null,
      reminderSentAt: job.review_reminder_sent_at as string | null,
      emailedAt: job.follow_up_sent_at as string | null,
      answered: answered.has(jobId),
      now,
    });
    if (!kind) continue;

    const customer = one(job.customers as unknown as Customer | Customer[] | null);
    // Opt-out before canText. Nothing is stamped, so turning the flag off later can still
    // send a text inside the normal window.
    if (skipsPostJobFollowUps(customer)) {
      skipped++;
      continue;
    }
    if (!customer?.phone || customer.sms_consent !== true || !(await canText(customer.phone))) {
      skipped++;
      continue;
    }

    // Claim first so an overlapping run cannot send it twice.
    const column = kind === "request" ? "review_request_sent_at" : "review_reminder_sent_at";
    const { data: claimed, error: claimError } = await supabase
      .from("jobs")
      .update({ [column]: now.toISOString() })
      .eq("id", jobId)
      .is(column, null)
      .select("id");
    if (claimError) {
      errors.push(`job ${jobId}: ${claimError.message}`);
      continue;
    }
    if (!claimed || claimed.length === 0) continue;

    const result = await sendSMS(customer.phone, reviewTextCopy({ kind, customerName: customer.name, url: `${APP_URL}/survey/${jobId}` }));
    if (result.ok) {
      sent++;
    } else {
      errors.push(`job ${jobId} text: ${result.error ?? "send failed"}`);
      // Nothing went out: release the claim so tomorrow's run tries again.
      const { error: releaseError } = await supabase.from("jobs").update({ [column]: null }).eq("id", jobId);
      if (releaseError) errors.push(`job ${jobId}: could not release claim: ${releaseError.message}`);
    }
  }

  return NextResponse.json({ sent, skipped, errors });
}
