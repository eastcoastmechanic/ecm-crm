import { supabase } from "@/lib/supabase";
import { phoneKey, toE164 } from "@/lib/phone";
import { COMPANY_NAME, COMPANY_PHONE } from "@/lib/brand";

// Single place for SMS consent: the outbound gate (canText), the inbound
// STOP/START/HELP keyword handler, and the double opt-in used by /sms-signup.
//
// State lives in three places, all kept in sync here:
//   customers.sms_consent   -- known customers
//   sms_optins              -- per-number record (pending / opted_in / opted_out),
//                              the only consent record for non-customers
//   sms_excluded_numbers    -- numbers we never text or AI-reply to; STOP adds a
//                              row labelled OPT_OUT_LABEL, START removes only those

const OPT_OUT_LABEL = "SMS opt-out (STOP)";

const OPT_OUT_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit"]);
const OPT_IN_WORDS = new Set(["start", "unstop"]);

export type SmsKeyword = "opt_out" | "opt_in" | "yes" | "help";

/** Case/whitespace-insensitive exact match on the whole message. */
export function parseSmsKeyword(body: string): SmsKeyword | null {
  const word = body.trim().toLowerCase().replace(/[.!?\s]+$/g, "");
  if (OPT_OUT_WORDS.has(word)) return "opt_out";
  if (OPT_IN_WORDS.has(word)) return "opt_in";
  if (word === "yes") return "yes";
  if (word === "help") return "help";
  return null;
}

type CustomerRow = { id: string; phone: string | null; sms_consent: boolean };

async function customersForPhone(key: string): Promise<CustomerRow[]> {
  const { data } = await supabase.from("customers").select("id, phone, sms_consent");
  return ((data ?? []) as CustomerRow[]).filter((c) => c.phone && phoneKey(c.phone) === key);
}

async function excludedRowsForPhone(key: string) {
  const { data } = await supabase.from("sms_excluded_numbers").select("id, phone_number, label");
  return (data ?? []).filter((r) => phoneKey(r.phone_number) === key);
}

async function getOptin(key: string) {
  const { data } = await supabase
    .from("sms_optins")
    .select("status, name, requested_at")
    .eq("phone_key", key)
    .maybeSingle();
  return data as { status: "pending" | "opted_in" | "opted_out"; name: string | null; requested_at: string } | null;
}

/**
 * May we send this number a text?
 *  - false if the number is opted out or in sms_excluded_numbers
 *  - false if a matching customer has sms_consent = false
 *  - known customer otherwise: true
 *  - no customer: true only with an explicit opt-in record, unless
 *    `allowUnknown` (used when replying to a text THEY just sent us).
 */
export async function canText(
  phone: string | null | undefined,
  opts: { allowUnknown?: boolean } = {}
): Promise<boolean> {
  if (!phone) return false;
  const key = phoneKey(phone);
  if (!key) return false;

  if ((await excludedRowsForPhone(key)).length > 0) return false;

  const optin = await getOptin(key);
  if (optin?.status === "opted_out") return false;

  const customers = await customersForPhone(key);
  if (customers.length > 0) return customers.every((c) => c.sms_consent);

  if (optin?.status === "opted_in") return true;
  return !!opts.allowUnknown;
}

async function setCustomerConsent(key: string, consent: boolean) {
  const customers = await customersForPhone(key);
  if (customers.length === 0) return;
  await supabase
    .from("customers")
    .update({ sms_consent: consent, sms_consent_at: new Date().toISOString() })
    .in(
      "id",
      customers.map((c) => c.id)
    );
}

async function optOut(phone: string) {
  const key = phoneKey(phone);
  const now = new Date().toISOString();
  await supabase
    .from("sms_optins")
    .upsert({ phone_key: key, phone: toE164(phone), status: "opted_out", updated_at: now });
  await setCustomerConsent(key, false);
  if ((await excludedRowsForPhone(key)).length === 0) {
    await supabase.from("sms_excluded_numbers").insert({ phone_number: toE164(phone), label: OPT_OUT_LABEL });
  }
}

async function optIn(phone: string, name: string | null, createCustomerIfMissing: boolean) {
  const key = phoneKey(phone);
  const now = new Date().toISOString();
  await supabase.from("sms_optins").upsert({
    phone_key: key,
    phone: toE164(phone),
    name,
    status: "opted_in",
    confirmed_at: now,
    updated_at: now,
  });
  const rows = (await excludedRowsForPhone(key)).filter((r) => r.label === OPT_OUT_LABEL);
  if (rows.length > 0) {
    await supabase
      .from("sms_excluded_numbers")
      .delete()
      .in(
        "id",
        rows.map((r) => r.id)
      );
  }
  const customers = await customersForPhone(key);
  if (customers.length > 0) {
    await setCustomerConsent(key, true);
  } else if (createCustomerIfMissing) {
    await supabase.from("customers").insert({
      name: name ?? "Unknown (SMS Signup)",
      phone: toE164(phone),
      sms_consent: true,
      sms_consent_at: now,
    });
  }
}

/** Start the double opt-in: record a pending request. Returns false if one was sent in the last 10 minutes. */
export async function requestOptIn(phone: string, name: string | null): Promise<boolean> {
  const key = phoneKey(phone);
  const existing = await getOptin(key);
  if (existing?.status === "pending" && Date.now() - new Date(existing.requested_at).getTime() < 10 * 60 * 1000) {
    return false;
  }
  // Never overwrite an active opt-in with a pending row.
  if (existing?.status === "opted_in") return false;
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("sms_optins")
    .upsert({ phone_key: key, phone: toE164(phone), name, status: "pending", requested_at: now, updated_at: now });
  if (error) throw new Error(error.message);
  return true;
}

export const OPT_IN_CONFIRM_REQUEST = `${COMPANY_NAME}: Reply YES to confirm you want appointment text updates. Msg frequency varies. Msg&data rates may apply. Reply STOP to opt out, HELP for help.`;

/**
 * Handle STOP/START/HELP/YES for an inbound text. Returns the single reply to
 * send, or null if the message is not a keyword (go on to normal handling).
 * YES only counts when a double opt-in is pending for that number, so a "yes"
 * answering the AI receptionist is not swallowed.
 */
export async function handleSmsKeyword(from: string, body: string): Promise<string | null> {
  const keyword = parseSmsKeyword(body);
  if (!keyword) return null;

  if (keyword === "opt_out") {
    await optOut(from);
    return `${COMPANY_NAME}: You're unsubscribed and won't receive more texts. Reply START to resubscribe.`;
  }
  if (keyword === "help") {
    return `${COMPANY_NAME}: For help call ${COMPANY_PHONE}. Msg&data rates may apply. Reply STOP to opt out.`;
  }
  if (keyword === "yes") {
    const pending = await getOptin(phoneKey(from));
    if (pending?.status !== "pending") return null;
    await optIn(from, pending.name, true);
    return `${COMPANY_NAME}: You're subscribed to appointment text updates. Msg frequency varies. Reply STOP to opt out, HELP for help.`;
  }
  const existing = await getOptin(phoneKey(from));
  await optIn(from, existing?.name ?? null, false);
  return `${COMPANY_NAME}: You're subscribed to appointment text updates. Msg frequency varies. Reply STOP to opt out, HELP for help.`;
}
