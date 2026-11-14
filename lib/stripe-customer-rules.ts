// Pure rules for making a Stripe customer for each CRM customer. No database or Stripe imports so
// they can be tested. Only what the CRM has is sent; nothing is guessed.

export type StripeCrmCust = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  billing_address: string | null;
  stripe_customer_id: string | null;
};

export type StripeAddress = {
  line1: string;
  line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country: "US";
};

export type StripeCustomerParams = {
  name?: string;
  email?: string;
  phone?: string;
  address?: StripeAddress;
  metadata: { crm_customer_id: string };
};

export type StripeCustomerPlan = {
  toCreate: StripeCrmCust[];
  alreadyHave: number;
  /** No usable email or phone. */
  noContact: number;
};

/** The metadata key that ties a Stripe customer back to its CRM row. */
export const CRM_ID_KEY = "crm_customer_id";

/** At most this many per press, so one press stays well inside the function time limit. */
export const MAX_PER_RUN = 100;

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/** Stripe rejects a malformed email and fails the whole create, so only a plain address is sent. */
export function usableEmail(email: string | null | undefined): string | null {
  const e = (email ?? "").trim();
  return EMAIL.test(e) ? e : null;
}

export function usablePhone(phone: string | null | undefined): string | null {
  const p = (phone ?? "").trim();
  return p.replace(/\D/g, "").length >= 7 ? p : null;
}

export function planStripeCustomers(crm: StripeCrmCust[]): StripeCustomerPlan {
  const plan: StripeCustomerPlan = { toCreate: [], alreadyHave: 0, noContact: 0 };
  for (const c of crm) {
    if (c.stripe_customer_id) plan.alreadyHave += 1;
    else if (!usableEmail(c.email) && !usablePhone(c.phone)) plan.noContact += 1;
    else plan.toCreate.push(c);
  }
  return plan;
}

const STATE_ZIP = /^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/;

/**
 * "12 Main St, Unit 2, Plymouth, MA 02360" into Stripe's parts. When the text doesn't end in a
 * city and "ST 12345", the whole text goes in line1 rather than guessing which part is which.
 */
export function parseUsAddress(text: string | null | undefined): StripeAddress | undefined {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  const parts = t.split(",").map((p) => p.trim()).filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  const m = STATE_ZIP.exec(last);
  if (!m || parts.length < 3) return { line1: t.slice(0, 200), country: "US" };
  const [line1, ...middle] = parts.slice(0, -2);
  const address: StripeAddress = {
    line1,
    city: parts[parts.length - 2],
    state: m[1].toUpperCase(),
    postal_code: m[2],
    country: "US",
  };
  if (middle.length) address.line2 = middle.join(", ");
  return address;
}

/** Billing address first, else the customer's first property. */
export function stripeCustomerParams(c: StripeCrmCust, propertyAddress?: string | null): StripeCustomerParams {
  const params: StripeCustomerParams = { metadata: { [CRM_ID_KEY]: c.id } };
  const name = (c.name ?? "").trim();
  if (name) params.name = name;
  const email = usableEmail(c.email);
  if (email) params.email = email;
  const phone = usablePhone(c.phone);
  if (phone) params.phone = phone;
  const address = parseUsAddress(c.billing_address) ?? parseUsAddress(propertyAddress);
  if (address) params.address = address;
  return params;
}

/** Same key for the same CRM customer, so a retried create returns the first Stripe customer. */
export const stripeCustomerIdempotencyKey = (crmId: string) => `crm-customer-${crmId}`;

/** Stripe search query for a CRM id. CRM ids are UUIDs; anything else is refused rather than escaped. */
export function crmIdSearchQuery(crmId: string): string | null {
  return /^[0-9a-f-]{36}$/i.test(crmId) ? `metadata['${CRM_ID_KEY}']:'${crmId}'` : null;
}

/** "live" or "test" from the secret key prefix, without exposing the key. */
export function stripeMode(key: string | undefined): "live" | "test" | null {
  if (!key) return null;
  if (/^(sk|rk)_live_/.test(key)) return "live";
  if (/^(sk|rk)_test_/.test(key)) return "test";
  return null;
}
