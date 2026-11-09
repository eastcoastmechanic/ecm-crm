import { stripe } from "@/lib/stripe";
import { supabase } from "@/lib/supabase";
import { notifyOwnerOfMoney } from "@/lib/notify-owner";

/**
 * Charges a specific amount to a customer's saved card, off-session.
 *
 * For the MCP connector's propose_charge_customer (see
 * lib/internal-assistant/tools-mcp.ts) -- never called directly by an LLM
 * without going through that draft/confirm gate first.
 *
 * `idempotencyKey` should be stable for one approved charge (the confirm
 * token): if the confirm is retried after a timeout or an error, Stripe hands
 * back the first result instead of charging the card a second time.
 *
 * Only a `succeeded` payment is reported as charged. Josh gets an owner alert
 * either way.
 */
export async function chargeCustomerCard(
  customerId: string,
  amountDollars: number,
  reason: string,
  idempotencyKey: string
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

  const amount = `$${amountDollars.toFixed(2)}`;
  const path = `/customers/${customerId}`;
  const failed = async (why: string) => {
    await notifyOwnerOfMoney({
      title: `Card charge failed: ${customer.name}, ${amount}`,
      body: `${why} For: ${reason}.`,
      path,
    });
    return new Error(why);
  };

  let intent;
  try {
    intent = await stripe.paymentIntents.create(
      {
        amount: Math.round(amountDollars * 100),
        currency: "usd",
        customer: customer.stripe_customer_id,
        payment_method: paymentMethodId,
        off_session: true,
        confirm: true,
        description: reason,
        metadata: { crm_customer_id: customerId, source: "assistant_charge" },
      },
      { idempotencyKey }
    );
  } catch (err) {
    if (err instanceof stripe.errors.StripeCardError) {
      if (err.code === "authentication_required") {
        throw await failed(
          `${customer.name}'s card requires them to approve the charge themselves (3D Secure) — this can't be charged off-session. Use create_payment_link instead.`
        );
      }
      throw await failed(`Card declined: ${err.message}`);
    }
    throw await failed(`Stripe error: ${err instanceof Error ? err.message : "unknown"}. Check Stripe before trying again.`);
  }

  const card = paymentMethods.data[0]?.card;
  const cardLabel = card ? `${card.brand} ending ${card.last4}` : "card on file";

  if (intent.status === "succeeded") {
    await notifyOwnerOfMoney({
      title: `Card charged: ${customer.name}, ${amount}`,
      body: `Charged the ${cardLabel} for: ${reason}. Payment ${intent.id}.`,
      path,
    });
    return `Charged ${amount} to ${customer.name}'s ${cardLabel} (${reason}). Payment intent ${intent.id}.`;
  }

  if (intent.status === "processing") {
    await notifyOwnerOfMoney({
      title: `Card charge processing: ${customer.name}, ${amount}`,
      body: `The bank has not finished the charge yet (payment ${intent.id}). Check Stripe before charging again. For: ${reason}.`,
      path,
    });
    return `The ${amount} charge to ${customer.name}'s ${cardLabel} is still processing at the bank (payment intent ${intent.id}). It is NOT confirmed yet. Check Stripe before charging again.`;
  }

  throw await failed(
    `The charge did not go through (status ${intent.status}, payment intent ${intent.id}). Nothing was taken. Use create_payment_link instead.`
  );
}
