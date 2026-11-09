import { createHash } from "node:crypto";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { supabase } from "@/lib/supabase";

/**
 * Session metadata key set only when the stored Stripe customer no longer
 * exists. Its value is the dead id, so the webhook replaces exactly that one.
 */
export const REPLACE_STRIPE_CUSTOMER = "replace_stripe_customer";

type CheckoutDoc ={ id: string; doc_number: string | null; total: number; customer_id: string | null };

/**
 * The Stripe customer to attach a checkout to. A customer who already has one
 * keeps it: making a new Stripe customer on every payment would leave the saved
 * card that plan renewals charge (service_contracts.stripe_payment_method_id)
 * on the old record. Only a customer with no Stripe record gets a new one.
 */
export async function checkoutCustomerFields(
  crmCustomerId: string | null
): Promise<{ customer: string } | { customer_creation: "always" }> {
  if (crmCustomerId) {
    const { data, error } = await supabase
      .from("customers")
      .select("stripe_customer_id")
      .eq("id", crmCustomerId)
      .maybeSingle();
    if (error) console.error("[invoice-checkout] customer read failed:", error.message);
    if (data?.stripe_customer_id) return { customer: data.stripe_customer_id as string };
  }
  return { customer_creation: "always" };
}

function isMissingCustomer(err: unknown) {
  const e = err as { code?: string; param?: string } | null;
  return e?.code === "resource_missing" && e?.param === "customer";
}

/**
 * One Stripe Checkout session for an invoice, used by the portal's Pay Now and
 * the staff payment link so both behave the same. The metadata
 * (document_id + customer_id) is what app/api/stripe/webhook/route.ts reads to
 * mark the invoice paid; the same ids go on the payment itself so a later
 * refund or dispute can be traced back to the invoice.
 */
export async function createInvoiceCheckoutSession(
  doc: CheckoutDoc,
  urls: { success: string; cancel: string }
): Promise<Stripe.Checkout.Session> {
  return createCheckout(doc, Math.round(doc.total * 100), `Invoice ${doc.doc_number ?? doc.id} — East Coast Mechanical`, {}, urls);
}

/** Session metadata `kind` on a contract deposit. The webhook records it as a deposit, never as paid. */
export const DEPOSIT_KIND = "deposit";

/**
 * Checkout for a contract's deposit. Same customer handling and metadata as an
 * invoice, plus kind=deposit so app/api/stripe/webhook/route.ts records it on
 * the contract (lib/online-deposit.ts) instead of marking the contract paid.
 * depositCents must come from the signed terms (contractDepositCents), never
 * from the browser. The idempotency key makes a double press within a few
 * minutes return the same session instead of a second one.
 */
export async function createDepositCheckoutSession(
  doc: Omit<CheckoutDoc, "total">,
  depositCents: number,
  urls: { success: string; cancel: string }
): Promise<Stripe.Checkout.Session> {
  if (!Number.isInteger(depositCents) || depositCents <= 0) throw new Error("No deposit amount");
  return createCheckout(
    doc,
    depositCents,
    `Deposit on contract ${doc.doc_number ?? doc.id} — East Coast Mechanical`,
    { kind: DEPOSIT_KIND },
    urls,
    true
  );
}

async function createCheckout(
  doc: Omit<CheckoutDoc, "total">,
  amountCents: number,
  name: string,
  kind: Record<string, string>,
  urls: { success: string; cancel: string },
  idempotent = false
): Promise<Stripe.Checkout.Session> {
  const metadata: Record<string, string> = { document_id: doc.id, ...kind };
  if (doc.customer_id) metadata.customer_id = doc.customer_id;

  const build = (who: { customer: string } | { customer_creation: "always" }, extra: Record<string, string> = {}) => {
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: amountCents,
            product_data: { name },
          },
          quantity: 1,
        },
      ],
      ...who,
      // Saves the card on the Stripe customer so plan renewals can be charged
      // off-session later (only with the customer's renewal consent).
      payment_intent_data: { setup_future_usage: "off_session", metadata },
      metadata: { ...metadata, ...extra },
      success_url: urls.success,
      cancel_url: urls.cancel,
    };
    if (!idempotent) return stripe.checkout.sessions.create(params);
    // Same request within the same 10-minute window: Stripe hands back the first session.
    const window = Math.floor(Date.now() / 600_000);
    const key = createHash("sha256").update(JSON.stringify(params)).update(String(window)).digest("hex");
    return stripe.checkout.sessions.create(params, { idempotencyKey: `checkout-${key}` });
  };

  const who = await checkoutCustomerFields(doc.customer_id);
  try {
    return await build(who);
  } catch (err) {
    // The stored Stripe customer was deleted in the dashboard. Take the payment
    // on a new one rather than block it, and tell the webhook to replace the
    // stored id (it otherwise never overwrites one).
    if ("customer" in who && isMissingCustomer(err)) {
      console.error(`[invoice-checkout] stored Stripe customer is gone for document ${doc.id}; using a new one`);
      return build({ customer_creation: "always" }, { [REPLACE_STRIPE_CUSTOMER]: who.customer });
    }
    throw err;
  }
}
