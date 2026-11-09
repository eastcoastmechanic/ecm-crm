// Plan renewal notice: the contract's auto-renew text promises "We email you a
// renewal notice before each renewal". This file holds that promise in one place:
// when the notice goes out, what it says, and whether the card may be charged.
//
// Timing (New York calendar days):
//   - the notice goes out from RENEWAL_NOTICE_LEAD_DAYS (30) days before the plan's end_date
//   - the charge cron looks at plans from RENEWAL_CHARGE_WINDOW_DAYS (7) days before end_date
//   - a card is charged only once the notice for THIS term is at least
//     RENEWAL_NOTICE_MIN_DAYS (7) days old. No notice, no charge.
// Per term: renewal_reminder_sent_at only counts if it falls inside the current
// end_date's notice window, so last year's stamp never covers this year.
import { supabase } from "@/lib/supabase";
import { resend, RESEND_FROM_EMAIL, RESEND_REPLY_TO } from "@/lib/resend";
import { sendSMS } from "@/lib/sms";
import { canText } from "@/lib/sms-consent";
import { one } from "@/lib/appointment-reminder";
import { addDaysToDateKey, etDateKey, formatEtDate } from "@/lib/tz";
import { COMPANY_NAME, COMPANY_PHONE_DISPLAY } from "@/lib/brand";

/** The notice goes out this many days before the plan's end date. */
export const RENEWAL_NOTICE_LEAD_DAYS = 30;
/** The charge cron picks a plan up this many days before its end date. */
export const RENEWAL_CHARGE_WINDOW_DAYS = 7;
/** The customer gets at least this many days between the notice and the charge. */
export const RENEWAL_NOTICE_MIN_DAYS = 7;

/** True when `sentAt` is a notice for the term that ends on `endDate` (not an older term's). */
export function noticeCoversTerm(sentAt: string | null | undefined, endDate: string): boolean {
  if (!sentAt) return false;
  const sent = new Date(sentAt);
  if (Number.isNaN(sent.getTime())) return false;
  const sentDay = etDateKey(sent);
  return sentDay >= addDaysToDateKey(endDate, -RENEWAL_NOTICE_LEAD_DAYS) && sentDay <= endDate;
}

/** First New York day the card may be charged, given the day the notice went out. */
export function renewalChargeDate(endDate: string, noticeDay: string): string {
  const windowOpens = addDaysToDateKey(endDate, -RENEWAL_CHARGE_WINDOW_DAYS);
  const noticeWaitEnds = addDaysToDateKey(noticeDay, RENEWAL_NOTICE_MIN_DAYS);
  return windowOpens > noticeWaitEnds ? windowOpens : noticeWaitEnds;
}

export type ChargeGate =
  | { charge: true }
  | { charge: false; reason: "no_notice" | "notice_too_recent"; chargeDate: string | null };

/** May this term's renewal be charged today? Only with a notice for this term, sent long enough ago. */
export function renewalChargeGate(opts: {
  reminderSentAt: string | null | undefined;
  endDate: string;
  now?: Date;
}): ChargeGate {
  const { reminderSentAt, endDate, now = new Date() } = opts;
  if (!noticeCoversTerm(reminderSentAt, endDate)) {
    return { charge: false, reason: "no_notice", chargeDate: null };
  }
  const chargeDate = renewalChargeDate(endDate, etDateKey(new Date(reminderSentAt as string)));
  if (etDateKey(now) < chargeDate) return { charge: false, reason: "notice_too_recent", chargeDate };
  return { charge: true };
}

function dollars(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function longDate(dateKey: string) {
  return formatEtDate(dateKey, { month: "long", day: "numeric", year: "numeric" });
}

/**
 * Wording for the renewal notice. Pass `chargeDate` only when the customer agreed to
 * automatic renewal at a price and the card will be charged that day (on or before the
 * renewal date); otherwise the notice promises no charge.
 */
export function renewalNoticeCopy(opts: {
  customerName: string | null;
  planName: string | null;
  endDate: string;
  priceCents: number | null;
  /** The New York day the card will be charged; null when this notice does not lead to a charge. */
  chargeDate: string | null;
}) {
  const { customerName, planName, endDate, priceCents, chargeDate } = opts;
  const plan = planName?.trim() || "maintenance plan";
  const hi = customerName ? `Hi ${customerName},` : "Hi,";
  const renews = longDate(endDate);
  const price = priceCents && priceCents > 0 ? dollars(priceCents) : null;
  const change = `To cancel or change your plan, reply to this email or call us at ${COMPANY_PHONE_DISPLAY}`;

  if (chargeDate && price) {
    const charged = longDate(chargeDate);
    return {
      subject: `Your ${plan} renews on ${renews}`,
      email: `${hi}\n\nYour ${plan} with ${COMPANY_NAME} renews on ${renews} for another year. On ${charged} we will charge ${price} to the card on file, as you agreed when you signed up for automatic renewal.\n\n${change} before ${charged}.\n\n${COMPANY_NAME}`,
      text: `${COMPANY_NAME}: your ${plan} renews ${renews}. On ${charged} we'll charge ${price} to the card on file. To cancel or change, reply or call ${COMPANY_PHONE_DISPLAY}. Reply STOP to opt out of texts.`,
    };
  }

  const priceLine = price ? ` The renewal price is ${price} for the year.` : "";
  return {
    subject: `Your ${plan} renews on ${renews}`,
    email: `${hi}\n\nYour ${plan} with ${COMPANY_NAME} is up for renewal on ${renews}.${priceLine} We will not charge your card for it automatically; we'll be in touch about renewing.\n\n${change}.\n\n${COMPANY_NAME}`,
    text: `${COMPANY_NAME}: your ${plan} is up for renewal ${renews}.${priceLine} To renew, cancel or change, reply or call ${COMPANY_PHONE_DISPLAY}. Reply STOP to opt out of texts.`,
  };
}

type NoticeCustomer = {
  name: string | null;
  email: string | null;
  phone: string | null;
  sms_consent: boolean | null;
};

/**
 * Daily: email every active plan its renewal notice once per term, within
 * RENEWAL_NOTICE_LEAD_DAYS of the end date. Also texts it when the customer can be
 * texted. Only a sent email counts as the notice (that's what the contract promises);
 * with no email the plan is never charged and the charge cron alerts the owner.
 */
export async function sendContractRenewalNotices(now: Date = new Date()) {
  const today = etDateKey(now);
  const { data: contracts, error } = await supabase
    .from("service_contracts")
    .select(
      "id, plan_name, end_date, renewal_price_cents, auto_renew_authorized_at, renewal_reminder_sent_at, customers(name, email, phone, sms_consent)"
    )
    .eq("status", "active")
    .gte("end_date", today)
    .lte("end_date", addDaysToDateKey(today, RENEWAL_NOTICE_LEAD_DAYS));

  if (error) return { sent: 0, texted: 0, noEmail: 0, errors: [error.message] };

  const errors: string[] = [];
  let sent = 0;
  let texted = 0;
  let noEmail = 0;

  for (const contract of contracts ?? []) {
    const endDate = contract.end_date as string;
    // Already noticed for this term. A stamp from an earlier term doesn't count.
    if (noticeCoversTerm(contract.renewal_reminder_sent_at as string | null, endDate)) continue;

    const customer = one(contract.customers as unknown as NoticeCustomer | NoticeCustomer[] | null);
    const email = customer?.email?.trim();
    if (!email) {
      // Nothing stamped: no notice went out. The charge cron won't charge this
      // term and tells the owner.
      noEmail++;
      continue;
    }

    const priceCents = (contract.renewal_price_cents as number | null) ?? null;
    const autoRenew = !!contract.auto_renew_authorized_at && !!priceCents && priceCents > 0;
    const chargeDate = autoRenew ? renewalChargeDate(endDate, today) : null;
    const copy = renewalNoticeCopy({
      customerName: customer?.name ?? null,
      planName: (contract.plan_name as string | null) ?? null,
      endDate,
      priceCents,
      // A notice that comes too late to give the customer a week before the plan
      // ends can't lead to an automatic charge, so it doesn't promise one.
      chargeDate: chargeDate && chargeDate <= endDate ? chargeDate : null,
    });

    const { error: sendError } = await resend.emails.send({
      from: `${COMPANY_NAME} <${RESEND_FROM_EMAIL}>`,
      replyTo: RESEND_REPLY_TO,
      to: email,
      subject: copy.subject,
      text: copy.email,
    });
    if (sendError) {
      errors.push(`contract ${contract.id}: ${sendError.message}`);
      continue;
    }

    const { error: stampError } = await supabase
      .from("service_contracts")
      .update({ renewal_reminder_sent_at: now.toISOString() })
      .eq("id", contract.id);
    if (stampError) errors.push(`contract ${contract.id}: notice sent but not recorded: ${stampError.message}`);
    sent++;

    // The text is extra; the email is the notice. Consent first, then the STOP list.
    const phone = customer?.phone;
    if (phone && customer?.sms_consent === true && (await canText(phone))) {
      const result = await sendSMS(phone, copy.text);
      if (result.ok) texted++;
      else errors.push(`contract ${contract.id}: renewal text failed: ${result.error ?? "unknown"}`);
    }
  }

  return { sent, texted, noEmail, errors };
}
