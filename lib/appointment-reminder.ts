import { formatEtDateTime } from "@/lib/tz";

// Day-before appointment text to the customer. Kept apart from the cron route
// so the consent rule and the message can be tested without a database.

type CustomerContact = { name: string | null; phone: string | null; sms_consent: boolean | null };
type PropertyAddress = { address: string | null };

export type ReminderJobRow = {
  scheduled_at: string;
  customers: CustomerContact | CustomerContact[] | null;
  properties: PropertyAddress | PropertyAddress[] | null;
};

export type ReminderDecision =
  | { send: true; phone: string; body: string }
  | { send: false; reason: "no customer" | "no phone" | "no sms consent" };

/** Supabase returns a many-to-one relation as an object, a one-to-many as an array. Accept both. */
export function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

/** Texts only go to customers with a phone and sms_consent. */
export function appointmentReminder(job: ReminderJobRow): ReminderDecision {
  const customer = one(job.customers);
  const property = one(job.properties);

  if (!customer) return { send: false, reason: "no customer" };
  if (!customer.phone) return { send: false, reason: "no phone" };
  if (!customer.sms_consent) return { send: false, reason: "no sms consent" };

  const when = formatEtDateTime(job.scheduled_at, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });

  return {
    send: true,
    phone: customer.phone,
    body: `East Coast Mechanical: reminder — you're scheduled for ${when}${
      property?.address ? ` at ${property.address}` : ""
    }. Reply STOP to opt out.`,
  };
}
