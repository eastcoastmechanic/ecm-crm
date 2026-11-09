import { cronAuthorized } from "@/lib/cron-auth";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { resend, RESEND_FROM_EMAIL, RESEND_REPLY_TO } from "@/lib/resend";
import { movePlannerTaskForJob, createPlannerTask } from "@/lib/planner-connector";
import { sendWarrantyAlerts } from "@/lib/warranty-alerts";
import { sendMaintenancePlanCharges } from "@/lib/plan-renewal";
import { canText } from "@/lib/sms-consent";
import {
  shouldSendJobFollowUpEmail,
  skipsPostJobFollowUps,
  surveyEmailDue,
  surveyEmailWindow,
} from "@/lib/post-job-followups";
import {
  FIRST_FOLLOW_UP_DAY,
  LAST_FOLLOW_UP_DAY,
  estimateFollowUp,
  estimateFollowUpEmailBlocked,
  isTieredEstimate,
} from "@/lib/estimate-follow-up";

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoISO(n: number) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

function formatPrice(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

type CustomerContact = { name: string | null; email: string | null; no_followups?: boolean | null } | null;

async function sendOverdueInvoiceReminders() {
  const { data: invoices, error } = await supabase
    .from("documents")
    .select("id, doc_number, total, due_date, last_reminder_sent_at, job_id, customers(name, email)")
    .eq("type", "invoice")
    .eq("status", "sent")
    .lt("due_date", todayISODate())
    .or(`last_reminder_sent_at.is.null,last_reminder_sent_at.lte.${daysAgoISO(7)}`);

  if (error) return { sent: 0, errors: [error.message] };

  const errors: string[] = [];
  let sent = 0;

  for (const invoice of invoices ?? []) {
    // Every row here is overdue by the query above -- flag the job's Planner
    // card regardless of whether an email goes out, since a missing customer
    // email shouldn't also hide it from the internal board.
    if (invoice.job_id) {
      await movePlannerTaskForJob(invoice.job_id, "needs_attention");
    }

    const customer = invoice.customers as unknown as CustomerContact;
    const email = customer?.email;
    if (!email) continue;

    const { error: sendError } = await resend.emails.send({
      from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
      replyTo: RESEND_REPLY_TO,
      to: email,
      subject: `Reminder: Invoice ${invoice.doc_number ?? ""} is past due`,
      text: `Hi ${customer?.name ?? ""},\n\nThis is a friendly reminder that invoice ${invoice.doc_number ?? ""} for ${formatPrice(
        invoice.total ?? 0
      )} was due on ${invoice.due_date}. If you've already paid, please disregard this message.\n\nLet us know if you have any questions.\n\nEast Coast Mechanical`,
    });

    if (sendError) {
      errors.push(`invoice ${invoice.id}: ${sendError.message}`);
      continue;
    }

    await supabase
      .from("documents")
      .update({ last_reminder_sent_at: new Date().toISOString() })
      .eq("id", invoice.id);
    sent++;
  }

  return { sent, errors };
}

async function sendContractRenewalNotices() {
  const in30Days = new Date();
  in30Days.setDate(in30Days.getDate() + 30);

  const { data: contracts, error } = await supabase
    .from("service_contracts")
    .select("id, plan_name, end_date, customers(name, email)")
    .eq("status", "active")
    .gte("end_date", todayISODate())
    .lte("end_date", in30Days.toISOString().slice(0, 10))
    .is("renewal_reminder_sent_at", null);

  if (error) return { sent: 0, errors: [error.message] };

  const errors: string[] = [];
  let sent = 0;

  for (const contract of contracts ?? []) {
    const customer = contract.customers as unknown as CustomerContact;
    const email = customer?.email;
    if (!email) continue;

    const { error: sendError } = await resend.emails.send({
      from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
      replyTo: RESEND_REPLY_TO,
      to: email,
      subject: `Your service plan renews soon`,
      text: `Hi ${customer?.name ?? ""},\n\nYour service plan${
        contract.plan_name ? ` (${contract.plan_name})` : ""
      } renews on ${contract.end_date}. Reach out if you'd like to review your coverage before then.\n\nEast Coast Mechanical`,
    });

    if (sendError) {
      errors.push(`contract ${contract.id}: ${sendError.message}`);
      continue;
    }

    await supabase
      .from("service_contracts")
      .update({ renewal_reminder_sent_at: new Date().toISOString() })
      .eq("id", contract.id);
    sent++;
  }

  return { sent, errors };
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://ecm-crm.vercel.app";

// "How did we do" email: any finished job 1 to 14 days old that hasn't had it,
// so a day the cron misses is caught up the next day (lib/post-job-followups.ts).
async function sendJobFollowUps() {
  const now = new Date();
  const { finishedBefore, finishedAfter } = surveyEmailWindow(now);
  const { data: jobs, error } = await supabase
    .from("jobs")
    .select(
      "id, completed_at, follow_up_sent_at, review_request_sent_at, customers(name, email, phone, sms_consent, no_followups), properties(address)"
    )
    .eq("status", "complete")
    .lte("completed_at", finishedBefore)
    .gte("completed_at", finishedAfter)
    .is("follow_up_sent_at", null);

  if (error) return { sent: 0, errors: [error.message] };

  const errors: string[] = [];
  let sent = 0;

  for (const job of jobs ?? []) {
    if (!surveyEmailDue(job, now)) continue;
    const customer = job.customers as unknown as (CustomerContact & { phone?: string | null; sms_consent?: boolean | null });
    const property = job.properties as unknown as { address: string | null } | null;

    // Opt-out before the consent lookup. A shut-off customer gets neither this email nor the
    // review text. The job is not stamped, so turning the flag off later can still send one.
    const getsReviewText =
      !skipsPostJobFollowUps(customer) &&
      !!customer?.phone &&
      customer.sms_consent === true &&
      (await canText(customer.phone));
    const email = customer?.email;
    if (
      !email ||
      !shouldSendJobFollowUpEmail({
        email,
        noFollowups: customer?.no_followups,
        getsReviewText,
      })
    ) {
      continue;
    }

    const { error: sendError } = await resend.emails.send({
      from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
      replyTo: RESEND_REPLY_TO,
      to: email,
      subject: `How did we do?`,
      text: `Hi ${customer?.name ?? ""},\n\nThanks for choosing East Coast Mechanical for your recent service${
        property?.address ? ` at ${property.address}` : ""
      }. Mind taking 30 seconds to tell us how it went?\n\n${APP_URL}/survey/${job.id}\n\nEast Coast Mechanical`,
    });

    if (sendError) {
      errors.push(`job ${job.id}: ${sendError.message}`);
      continue;
    }

    await supabase
      .from("jobs")
      .update({ follow_up_sent_at: new Date().toISOString() })
      .eq("id", job.id);
    sent++;
  }

  return { sent, errors };
}

// At most two follow-ups per sending (about day 3 and day 10 after sent_at, New
// York days), none after day 16. The rule lives in lib/estimate-follow-up.ts.
async function sendStaleEstimateFollowUps() {
  const { data: estimates, error } = await supabase
    .from("documents")
    .select(
      "id, doc_number, total, sent_at, last_reminder_sent_at, line_items, customers(name, email, email_opt_out_at, no_followups)"
    )
    .eq("type", "estimate")
    .eq("status", "sent")
    .not("sent_at", "is", null)
    // Wider than the rule's window by a day each side; estimateFollowUp decides.
    .gte("sent_at", daysAgoISO(LAST_FOLLOW_UP_DAY + 1))
    .lte("sent_at", daysAgoISO(FIRST_FOLLOW_UP_DAY - 1));

  if (error) return { sent: 0, errors: [error.message] };

  const errors: string[] = [];
  let sent = 0;

  for (const estimate of estimates ?? []) {
    const decision = estimateFollowUp({
      sentAt: (estimate.sent_at as string | null) ?? null,
      lastReminderAt: (estimate.last_reminder_sent_at as string | null) ?? null,
    });
    if (!decision.send) continue;

    const customer = estimate.customers as unknown as
      | (CustomerContact & { email_opt_out_at?: string | null })
      | null;
    const email = estimateFollowUpEmailBlocked(customer) ? null : customer?.email;
    const tiered = isTieredEstimate(estimate.line_items as Parameters<typeof isTieredEstimate>[0]);
    const what = tiered
      ? `estimate ${estimate.doc_number ?? ""} and your options`
      : `estimate ${estimate.doc_number ?? ""} for ${formatPrice(estimate.total ?? 0)}`;

    if (email) {
      const { error: sendError } = await resend.emails.send({
        from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
        replyTo: RESEND_REPLY_TO,
        to: email,
        subject: `Following up on estimate ${estimate.doc_number ?? ""}`,
        text: `Hi ${customer?.name ?? ""},\n\nJust checking in on ${what}. Let us know if you have any questions or would like to move forward — happy to help either way.\n\nEast Coast Mechanical`,
      });

      if (sendError) {
        errors.push(`estimate ${estimate.id}: ${sendError.message}`);
        continue;
      }
    }

    // The marker is written whether or not there was an email to send, and
    // before the Planner card, so a customer with no email address doesn't
    // get a new card every day and a failed card can't be created twice.
    const { error: updateError } = await supabase
      .from("documents")
      .update({ last_reminder_sent_at: new Date().toISOString() })
      .eq("id", estimate.id);
    if (updateError) {
      errors.push(`estimate ${estimate.id}: ${updateError.message}`);
      continue;
    }
    if (email) sent++;

    // First follow-up for this sending also flags it for staff. One Planner
    // card per sending is enough; it isn't going anywhere until someone acts on it.
    if (decision.first) {
      try {
        await createPlannerTask({
          title: `Follow up: ${customer?.name ?? "Customer"} — estimate ${estimate.doc_number ?? ""}`,
          notes: `Sitting at "sent" with no response for ${FIRST_FOLLOW_UP_DAY}+ days.`,
          bucket: "tasks",
        });
      } catch (err) {
        errors.push(`estimate ${estimate.id} planner card: ${err instanceof Error ? err.message : "failed"}`);
      }
    }
  }

  return { sent, errors };
}

async function sendMassSaveStallAlerts() {
  const { data: rebates, error } = await supabase
    .from("documents")
    .select("id, doc_number, last_reminder_sent_at, customers(name, email)")
    .eq("type", "mass_save_rebate")
    .eq("status", "sent")
    .lte("created_at", daysAgoISO(14))
    .is("last_reminder_sent_at", null);

  if (error) return { flagged: 0, errors: [error.message] };

  const errors: string[] = [];
  let flagged = 0;

  // Internal-only -- Mass Save paperwork is ECM's process, not the
  // customer's, so this is a Planner card, not an email.
  for (const rebate of rebates ?? []) {
    const customer = rebate.customers as unknown as CustomerContact;

    // Flag first: if the card fails we log it, but the next run can't
    // create a second card for the same rebate.
    const { error: updateError } = await supabase
      .from("documents")
      .update({ last_reminder_sent_at: new Date().toISOString() })
      .eq("id", rebate.id);
    if (updateError) {
      errors.push(`rebate ${rebate.id}: ${updateError.message}`);
      continue;
    }
    flagged++;

    try {
      await createPlannerTask({
        title: `Mass Save stalled: ${customer?.name ?? "Customer"} — ${rebate.doc_number ?? ""}`,
        notes: `Submitted 14+ days ago with no status update. Check on approval.`,
        bucket: "tasks",
      });
    } catch (err) {
      errors.push(`rebate ${rebate.id} planner card: ${err instanceof Error ? err.message : "failed"}`);
    }
  }

  return { flagged, errors };
}

export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // One failing job must not throw away the results (and already-sent emails)
  // of the others, so settle them all and report each outcome.
  const jobs = {
    invoiceReminders: sendOverdueInvoiceReminders,
    contractRenewals: sendContractRenewalNotices,
    jobFollowUps: sendJobFollowUps,
    estimateFollowUps: sendStaleEstimateFollowUps,
    massSaveStallAlerts: sendMassSaveStallAlerts,
    warrantyAlerts: sendWarrantyAlerts,
    maintenancePlanCharges: sendMaintenancePlanCharges,
  };
  const names = Object.keys(jobs) as (keyof typeof jobs)[];
  const settled = await Promise.allSettled(names.map((name) => jobs[name]()));

  const body: Record<string, unknown> = {};
  settled.forEach((outcome, i) => {
    if (outcome.status === "fulfilled") {
      body[names[i]] = outcome.value;
    } else {
      const message = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      console.error(`[email-reminders] ${names[i]} failed:`, outcome.reason);
      body[names[i]] = { errors: [message], failed: true };
    }
  });

  return NextResponse.json(body);
}
