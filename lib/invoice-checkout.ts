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
  const metadata: Record<string, string> = { document_id: doc.id };
  if (doc.customer_id) metadata.customer_id = doc.customer_id;

  const build = (who: { customer: string } | { customer_creation: "always" }, extra: Record<string, string> = {}) =>
    stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: Math.round(doc.total * 100),
            product_data: { name: `Invoice ${doc.doc_number ?? doc.id} — East Coast Mechanical` },
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
    });

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
