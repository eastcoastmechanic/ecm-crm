import { stripe } from "@/lib/stripe";
import { supabase } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/fetch-all";
import {
  MAX_PER_RUN,
  crmIdSearchQuery,
  planStripeCustomers,
  stripeCustomerIdempotencyKey,
  stripeCustomerParams,
  stripeMode,
  type StripeCrmCust,
} from "@/lib/stripe-customer-rules";

export type StripeCustomersResult = {
  error?: string;
  dryRun: boolean;
  mode: "live" | "test" | null;
  total: number;
  alreadyHave: number;
  noContact: number;
  willCreate: number;
  /** New Stripe customers made this run. */
  created: number;
  /** Found already in Stripe (an earlier run) and linked, nothing new made. */
  reused: number;
  failed: number;
  /** Stripe error codes of failures, no customer data. */
  failCodes: string[];
  /** Left for the next press (over MAX_PER_RUN). */
  remaining: number;
};

export const emptyStripeCustomersResult = (dryRun: boolean): StripeCustomersResult => ({
  dryRun,
  mode: stripeMode(process.env.STRIPE_SECRET_KEY),
  total: 0,
  alreadyHave: 0,
  noContact: 0,
  willCreate: 0,
  created: 0,
  reused: 0,
  failed: 0,
  failCodes: [],
  remaining: 0,
});

const CONCURRENCY = 4;

type Outcome = { kind: "created" | "reused" } | { kind: "failed"; code: string };

async function ensureStripeCustomer(c: StripeCrmCust, propertyAddress: string | null): Promise<Outcome> {
  try {
    let stripeId: string | null = null;
    let kind: "created" | "reused" = "reused";
    // A Stripe customer from an earlier run (whose CRM save failed) is reused, not duplicated.
    const query = crmIdSearchQuery(c.id);
    if (query) {
      const found = await stripe.customers.search({ query, limit: 1 });
      stripeId = found.data[0]?.id ?? null;
    }
    if (!stripeId) {
      // Search can lag a minute behind a create; the idempotency key covers a quick rerun.
      const made = await stripe.customers.create(stripeCustomerParams(c, propertyAddress), {
        idempotencyKey: stripeCustomerIdempotencyKey(c.id),
      });
      stripeId = made.id;
      kind = "created";
    }
    // Never replace an id saved meanwhile (for example by a checkout payment).
    const { data, error } = await supabase
      .from("customers")
      .update({ stripe_customer_id: stripeId })
      .eq("id", c.id)
      .is("stripe_customer_id", null)
      .select("id");
    if (error) return { kind: "failed", code: "crm_save_failed" };
    if (!data?.length) return { kind: "failed", code: "crm_changed_meanwhile" };
    return { kind };
  } catch (err) {
    const e = err as { code?: string; type?: string } | null;
    return { kind: "failed", code: e?.code || e?.type || "error" };
  }
}

/**
 * Owner tool. Dry run only counts (no Stripe calls). The real run makes a Stripe customer for each
 * CRM customer that has none and has an email or phone, saves its id on the CRM row, and reports
 * created / reused / failed. One failure doesn't stop the others. Safe to run again.
 */
export async function createStripeCustomers(dryRun: boolean): Promise<StripeCustomersResult> {
  const out = emptyStripeCustomersResult(dryRun);

  const customers = await fetchAllRows<StripeCrmCust>((from, to) =>
    supabase
      .from("customers")
      .select("id, name, email, phone, billing_address, stripe_customer_id")
      .order("id")
      .range(from, to)
  );
  if (customers.error) return { ...out, error: customers.error };
  const props = await fetchAllRows<{ customer_id: string | null; address: string | null }>((from, to) =>
    supabase.from("properties").select("customer_id, address, created_at").order("created_at").order("id").range(from, to)
  );
  if (props.error) return { ...out, error: props.error };
  const crm = customers.data;
  const properties = props.data;

  const plan = planStripeCustomers(crm);
  out.total = crm.length;
  out.alreadyHave = plan.alreadyHave;
  out.noContact = plan.noContact;
  out.willCreate = plan.toCreate.length;
  if (dryRun) return out;

  const firstProperty = new Map<string, string>();
  for (const p of properties) {
    if (p.customer_id && p.address && !firstProperty.has(p.customer_id)) firstProperty.set(p.customer_id, p.address);
  }

  const batch = plan.toCreate.slice(0, MAX_PER_RUN);
  out.remaining = plan.toCreate.length - batch.length;
  let next = 0;
  const codes = new Set<string>();
  const worker = async () => {
    while (next < batch.length) {
      const c = batch[next++];
      const r = await ensureStripeCustomer(c, firstProperty.get(c.id) ?? null);
      if (r.kind === "failed") {
        out.failed += 1;
        codes.add(r.code);
      } else out[r.kind] += 1;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.length) }, worker));
  out.failCodes = [...codes];
  return out;
}
