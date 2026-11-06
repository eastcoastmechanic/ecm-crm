import { canText as canTextNumber } from "@/lib/sms-consent";
import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { supabase } from "@/lib/supabase";
import { sendSMS } from "@/lib/sms";
import { resend, RESEND_FROM_EMAIL, RESEND_REPLY_TO } from "@/lib/resend";
import { COMPANY_NAME } from "@/lib/brand";
import { nextReminder, reminderCopy, type ReminderKind } from "@/lib/plan-visit-reminders";

type Customer = { name: string | null; email: string | null; phone: string | null; sms_consent: boolean | null };
type JobRel = { status: string | null; scheduled_at: string | null };

function one<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

// Daily, mid-morning New York time (see vercel.json) so no text lands at dawn.
// Each unscheduled plan visit gets one booking reminder, then one follow-up a week later.
// Text goes only to customers with sms_consent; everyone with an email gets the email.
export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: visits, error } = await supabase
    .from("maintenance_visits")
    .select(
      "id, label, due_month, booking_reminder_sent_at, followup_reminder_sent_at, customers(name, email, phone, sms_consent), jobs(status, scheduled_at)"
    )
    .eq("status", "due")
    .not("job_id", "is", null);
  if (error) return NextResponse.json({ sent: 0, errors: [error.message] });

  const now = new Date();
  const errors: string[] = [];
  let sent = 0;
  let skipped = 0;

  for (const v of visits ?? []) {
    const job = one(v.jobs as unknown as JobRel | JobRel[] | null);
    // Booked, finished or cancelled: nothing to ask for.
    if (!job || job.scheduled_at || job.status === "complete" || job.status === "completed" || job.status === "cancelled") {
      continue;
    }

    const kind = nextReminder({
      bookingSentAt: v.booking_reminder_sent_at as string | null,
      followupSentAt: v.followup_reminder_sent_at as string | null,
      now,
    });
    if (!kind) continue;

    const customer = one(v.customers as unknown as Customer | Customer[] | null);
    const canText = !!customer?.phone && customer.sms_consent === true && (await canTextNumber(customer.phone));
    const canEmail = !!customer?.email;
    if (!customer || (!canText && !canEmail)) {
      skipped++;
      continue;
    }

    // Claim the reminder first so an overlapping run cannot send it twice.
    const column: "booking_reminder_sent_at" | "followup_reminder_sent_at" =
      kind === "booking" ? "booking_reminder_sent_at" : "followup_reminder_sent_at";
    const { data: claimed, error: claimError } = await supabase
      .from("maintenance_visits")
      .update({ [column]: now.toISOString() })
      .eq("id", v.id)
      .is(column, null)
      .select("id");
    if (claimError) {
      errors.push(`visit ${v.id}: ${claimError.message}`);
      continue;
    }
    if (!claimed || claimed.length === 0) continue;

    const reached = await deliver({
      kind,
      customer,
      canText,
      canEmail,
      label: (v.label as string | null) ?? "Maintenance visit",
      month: v.due_month as number,
      errors,
      visitId: v.id as string,
    });

    if (reached) {
      sent++;
    } else {
      // Nothing got through: release the claim so tomorrow's run tries again.
      const { error: releaseError } = await supabase.from("maintenance_visits").update({ [column]: null }).eq("id", v.id);
      if (releaseError) errors.push(`visit ${v.id}: could not release reminder claim: ${releaseError.message}`);
    }
  }

  return NextResponse.json({ sent, skipped, errors });
}

async function deliver(opts: {
  kind: ReminderKind;
  customer: Customer;
  canText: boolean;
  canEmail: boolean;
  label: string;
  month: number;
  errors: string[];
  visitId: string;
}): Promise<boolean> {
  const { kind, customer, canText, canEmail, label, month, errors, visitId } = opts;
  const copy = reminderCopy({ kind, customerName: customer.name, label, month });
  let reached = false;

  if (canEmail) {
    try {
      const { error: sendError } = await resend.emails.send({
        from: `${COMPANY_NAME} <${RESEND_FROM_EMAIL}>`,
        replyTo: RESEND_REPLY_TO,
        to: customer.email as string,
        subject: copy.subject,
        text: copy.email,
      });
      if (sendError) errors.push(`visit ${visitId} email: ${sendError.message}`);
      else reached = true;
    } catch (err) {
      errors.push(`visit ${visitId} email: ${err instanceof Error ? err.message : "send failed"}`);
    }
  }

  if (canText) {
    const result = await sendSMS(customer.phone, copy.text);
    if (!result.ok) errors.push(`visit ${visitId} text: ${result.error ?? "send failed"}`);
    else reached = true;
  }

  return reached;
}
