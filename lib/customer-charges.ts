import { stripe } from "@/lib/stripe";
import { supabase } from "@/lib/supabase";

/**
 * Charges a specific amount to a customer's saved card, off-session.
 *
 * Generalizes the pattern already used inline in
 * app/api/cron/email-reminders/route.ts's sendMaintenancePlanCharges --
 * that one only ever charges a hardcoded $299 for plan renewals. This is
 * the parameterized version, for the MCP connector's propose_charge_customer
 * (see lib/internal-assistant/tools-mcp.ts) -- never called directly by an
 * LLM without going through that draft/confirm gate first.
 */
export async function chargeCustomerCard(
  customerId: string,
  amountDollars: number,
  reason: string
): Promise<string> {
  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select("name, stripe_customer_id")
    .eq("id", customerId)
    .single();
  if (customerError || !customer) {
    throw new Error(customerError?.message ?? `Customer ${customerId} not found`);
  }
  if (!customer.stripe_customer_id) {
    throw new Error(`${customer.name} has no Stripe customer record on file — nothing to charge.`);
  }

  const paymentMethods = await stripe.paymentMethods.list({
    customer: customer.stripe_customer_id,
    type: "card",
  });
  const paymentMethodId = paymentMethods.data[0]?.id;
  if (!paymentMethodId) {
    throw new Error(`${customer.name} has no saved card on file. Use create_payment_link instead.`);
  }

  try {
    const intent = await stripe.paymentIntents.create({
      amount: Math.round(amountDollars * 100),
      currency: "usd",
      customer: customer.stripe_customer_id,
      payment_method: paymentMethodId,
      off_session: true,
      confirm: true,
      description: reason,
    });

    const card = paymentMethods.data[0]?.card;
    const cardLabel = card ? `${card.brand} ending ${card.last4}` : "card on file";
    return `Charged $${amountDollars.toFixed(2)} to ${customer.name}'s ${cardLabel} (${reason}). Payment intent ${intent.id}.`;
  } catch (err) {
    if (err instanceof stripe.errors.StripeCardError) {
      if (err.code === "authentication_required") {
        throw new Error(
          `${customer.name}'s card requires them to approve the charge themselves (3D Secure) — this can't be charged off-session. Use create_payment_link instead.`
        );
      }
      throw new Error(`Card declined: ${err.message}`);
    }
    throw err;
  }
}
