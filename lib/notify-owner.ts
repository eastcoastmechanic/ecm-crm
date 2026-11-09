import { resend, RESEND_FROM_EMAIL } from "@/lib/resend";
import { supabase } from "@/lib/supabase";
import { sendSMS } from "@/lib/sms";
import { postToTeams } from "@/lib/teams";
import { formatEtDateTime } from "@/lib/tz";
import { selectedTier, TIER_LABEL } from "@/lib/estimate-tier";

const OWNER_EMAIL = process.env.OWNER_EMAIL;

/**
 * A "requested" job from an anonymous website visitor (booking form or
 * chatbot) doesn't otherwise surface anywhere until staff happen to check
 * the Jobs list — unlike scheduled jobs, which already email OWNER_EMAIL.
 * This fires immediately so a new web lead doesn't sit unseen.
 */
export async function notifyOwnerOfWebLead(params: {
  source: "web_form" | "web_chat";
  customerName: string;
  phone: string | null;
  address: string;
  description: string;
  scheduledAt: Date;
}) {
  if (!OWNER_EMAIL) return;

  const { source, customerName, phone, address, description, scheduledAt } = params;
  const sourceLabel = source === "web_chat" ? "AI chatbot" : "website booking form";

  await resend.emails.send({
    from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
    to: OWNER_EMAIL,
    subject: `New web lead: ${customerName}`,
    text: `New service request from the ${sourceLabel}, pending confirmation.

Name: ${customerName}
Phone: ${phone ?? "not provided"}
Address: ${address}
Requested time: ${formatEtDateTime(scheduledAt)} ET
Details: ${description}

Review and confirm in the Jobs tab.`,
  });
}

/**
 * A 1-3 star survey response means an unhappy customer is about to be asked
 * to leave a public review — catch it here instead, before it becomes one.
 */
export async function notifyOwnerOfLowSurveyRating(params: {
  customerName: string;
  rating: number;
  comment: string | null;
}) {
  if (!OWNER_EMAIL) return;

  const { customerName, rating, comment } = params;

  await resend.emails.send({
    from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
    to: OWNER_EMAIL,
    subject: `Low survey rating (${rating}/5) from ${customerName}`,
    text: `${customerName} rated their recent service ${rating}/5.

${comment ? `Their comment: "${comment}"` : "No comment left."}

Worth a follow-up call before this turns into a public review.`,
  });
}

/**
 * A referred customer just had their first paid invoice — the referral
 * hasn't been auto-rewarded (that's a manual credit decision), just flagged
 * so it doesn't get forgotten.
 */
export async function notifyOwnerOfReferralReward(params: {
  referrerName: string;
  referrerId: string;
  referredName: string;
}) {
  if (!OWNER_EMAIL) return;

  const { referrerName, referrerId, referredName } = params;

  await resend.emails.send({
    from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
    to: OWNER_EMAIL,
    subject: `Referral reward due: ${referrerName}`,
    text: `${referredName}, who was referred by ${referrerName}, just had their first invoice paid.

${referrerName} is due a referral reward. Review and issue it manually — this is just a reminder, nothing was charged or credited automatically.

Referrer customer ID: ${referrerId}`,
  });
}

export type OwnerEvent = "estimate_approved" | "contract_signed" | "invoice_paid" | "job_completed";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://ecm-crm.vercel.app";
const OWNER_PHONE = process.env.OWNER_PHONE;

function money(n: number | string | null | undefined) {
  const value = Number(n);
  if (!Number.isFinite(value)) return null;
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * Tells the owner when money moves: an estimate is approved, a contract is
 * signed, an invoice is paid (email + text), or a job is finished (email only,
 * so a busy day doesn't mean a text per job). Text goes to OWNER_PHONE; email
 * to OWNER_EMAIL. Whatever is not configured is skipped.
 *
 * Never throws: an alert must not undo or fail the thing it reports.
 */
export async function notifyOwnerOfEvent(kind: OwnerEvent, id: string) {
  try {
    let who = "A customer";
    let what = "";
    let link = `${APP_URL}/documents/${id}`;

    if (kind === "job_completed") {
      const { data: job } = await supabase
        .from("jobs")
        .select("tracked_hours, customers(name), properties(address)")
        .eq("id", id)
        .single();
      const customer = Array.isArray(job?.customers) ? job?.customers[0] : job?.customers;
      const property = Array.isArray(job?.properties) ? job?.properties[0] : job?.properties;
      who = customer?.name ?? who;
      what = [property?.address, job?.tracked_hours ? `${job.tracked_hours} h on site` : null].filter(Boolean).join(" · ");
      link = `${APP_URL}/jobs`;
    } else {
      const { data: doc } = await supabase
        .from("documents")
        .select("doc_number, total, line_items, selected_tier, customers(name)")
        .eq("id", id)
        .single();
      const customer = Array.isArray(doc?.customers) ? doc?.customers[0] : doc?.customers;
      who = customer?.name ?? who;
      const tier = selectedTier((doc?.line_items as { pricing_mode?: string } | null)?.pricing_mode, doc?.selected_tier);
      what = [doc?.doc_number, money(doc?.total), tier ? `${TIER_LABEL[tier]} option` : null].filter(Boolean).join(" · ");
    }

    const headline = {
      estimate_approved: `${who} approved an estimate`,
      contract_signed: `${who} signed a contract`,
      invoice_paid: `${who} paid an invoice`,
      job_completed: `Job finished: ${who}`,
    }[kind];
    const line = what ? `${headline} (${what})` : headline;

    // Teams first: it never throws, so a failed email or text can't skip it.
    // Teams. Money events carry amounts, so they go only to the private Money
    // Alerts channel. A finished job has no prices, so it goes to Dispatch where
    // the techs see it.
    await postToTeams(kind === "job_completed" ? "dispatch" : "money", {
      title: line,
      url: link,
    });

    if (OWNER_EMAIL) {
      await resend.emails.send({
        from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
        to: OWNER_EMAIL,
        subject: line,
        text: `${line}\n\n${link}`,
      });
    }
    if (OWNER_PHONE && kind !== "job_completed") {
      await sendSMS(OWNER_PHONE, `ECM: ${line}`);
    }
  } catch (err) {
    console.error(`[notify-owner] ${kind} alert failed for ${id}:`, err);
  }
}

/**
 * The phone/text receptionist booked a job request or moved an existing job. Both
 * are pending: nothing is confirmed to the customer until the office sets the job
 * to Scheduled. This puts it in front of Josh (Teams Dispatch plus email) so it
 * doesn't sit unseen on the Jobs list. Never throws: the request is already saved.
 */
export async function notifyOwnerOfReceptionistRequest(params: {
  kind: "new" | "reschedule";
  jobId: string;
  channel: string;
  previousAt?: string | null;
}) {
  const { kind, jobId, channel, previousAt } = params;
  try {
    const { data: job } = await supabase
      .from("jobs")
      .select("scheduled_at, notes, customers(name, phone), properties(address)")
      .eq("id", jobId)
      .single();
    const customer = Array.isArray(job?.customers) ? job?.customers[0] : job?.customers;
    const property = Array.isArray(job?.properties) ? job?.properties[0] : job?.properties;
    const who = customer?.name ?? "A caller";
    const via = channel === "ai_voice" ? "phone" : channel === "ai_sms" ? "text" : "receptionist";
    const when = job?.scheduled_at ? `${formatEtDateTime(job.scheduled_at)} ET` : "no time given";
    const line =
      kind === "new" ? `New job request by ${via}: ${who}, ${when}` : `${who} asked by ${via} to move their job to ${when}`;
    const details = [
      kind === "reschedule" ? `Was: ${previousAt ? `${formatEtDateTime(previousAt)} ET` : "no time set"}` : null,
      property?.address ? `Address: ${property.address}` : null,
      customer?.phone ? `Phone: ${customer.phone}` : "No phone on file.",
      kind === "new" && job?.notes ? `Details: ${job.notes}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    const link = `${APP_URL}/dispatch`;

    await postToTeams("dispatch", { title: line, text: details, url: link });

    if (OWNER_EMAIL) {
      await resend.emails.send({
        from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
        to: OWNER_EMAIL,
        subject: line,
        text: `${line}.\n\n${details}\n\nPending: the customer was told it needs confirming. Confirm or change the time on the dispatch board, which sets it to Scheduled and sends the customer their notice:\n${link}`,
      });
    }
  } catch (err) {
    console.error(`[notify-owner] receptionist ${kind} alert failed for ${jobId}:`, err);
  }
}

/**
 * A customer tapped the link in their plan visit reminder and asked for a visit.
 * Nothing is scheduled for them: this just puts the request in front of Josh with
 * their note, so he can call or pick a day on the dispatch board.
 * Never throws: the customer's request is already saved.
 */
export async function notifyOwnerOfVisitRequest(visitId: string) {
  try {
    const { data: visit } = await supabase
      .from("maintenance_visits")
      .select("label, due_month, customer_request_note, customers(name, phone)")
      .eq("id", visitId)
      .single();
    const customer = Array.isArray(visit?.customers) ? visit?.customers[0] : visit?.customers;
    const who = customer?.name ?? "A customer";
    const label = (visit?.label ?? "maintenance visit").toLowerCase();
    const line = `${who} asked to book their ${label}`;
    const note = visit?.customer_request_note ? `Their note: "${visit.customer_request_note}"` : "No days given.";
    const phone = customer?.phone ? `Phone: ${customer.phone}` : "No phone on file.";
    const link = `${APP_URL}/dispatch`;

    await postToTeams("dispatch", { title: line, text: `${note}\n${phone}`, url: link });

    if (OWNER_EMAIL) {
      await resend.emails.send({
        from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
        to: OWNER_EMAIL,
        subject: line,
        text: `${line}.\n\n${note}\n${phone}\n\nNothing was scheduled. Pick a day on the dispatch board, under Needs scheduling:\n${link}`,
      });
    }
  } catch (err) {
    console.error(`[notify-owner] visit request alert failed for ${visitId}:`, err);
  }
}
