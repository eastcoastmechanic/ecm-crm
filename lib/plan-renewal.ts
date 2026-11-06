import { supabase } from "@/lib/supabase";
import { stripe } from "@/lib/stripe";
import { one } from "@/lib/appointment-reminder";

type PlanCustomer = { id: string; name: string | null; email: string | null; stripe_customer_id: string | null };

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

// Plans renew for one year; end_date is a plain YYYY-MM-DD.
export function addOneYear(isoDate: string) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

/** Charges each auto-renew plan's saved card the week before it ends, then rolls it forward a year. */
export async function sendMaintenancePlanCharges() {
  const in7Days = new Date();
  in7Days.setDate(in7Days.getDate() + 7);

  const { data: contracts, error } = await supabase
    .from("service_contracts")
    .select(
      "id, plan_name, end_date, renewal_price_cents, stripe_payment_method_id, customers(id, name, email, stripe_customer_id)"
    )
    .eq("status", "active")
    // Only contracts where the customer agreed to automatic renewal, at a price on the
    // contract (migration 0046). A saved card alone is NOT consent: checkout saves the
    // card for every online payment.
    .not("auto_renew_authorized_at", "is", null)
    .gt("renewal_price_cents", 0)
    .gte("end_date", todayISODate())
    .lte("end_date", in7Days.toISOString().slice(0, 10))
    .is("auto_billed_at", null);

  if (error) return { charged: 0, skipped: 0, errors: [error.message] };

  const errors: string[] = [];
  let charged = 0;
  let skipped = 0;

  for (const contract of contracts ?? []) {
    // service_contracts.customer_id is a single foreign key, so Supabase returns the
    // customer as an object. Reading [0] found nothing, so every renewal was skipped.
    const customer = one(
      contract.customers as unknown as PlanCustomer | PlanCustomer[] | null
    );

    if (!customer?.stripe_customer_id) {
      skipped++;
      continue;
    }

    try {
      const paymentMethodId =
        contract.stripe_payment_method_id ??
        (
          await stripe.paymentMethods.list({
            customer: customer.stripe_customer_id,
            type: "card",
          })
        ).data[0]?.id;
      if (!paymentMethodId) {
        skipped++;
        continue;
      }

      const intent = await stripe.paymentIntents.create(
        {
          amount: contract.renewal_price_cents as number,
          currency: "usd",
          customer: customer.stripe_customer_id,
          payment_method: paymentMethodId,
          off_session: true,
          confirm: true,
          description: `Service plan renewal${contract.plan_name ? ` — ${contract.plan_name}` : ""}`,
          metadata: { service_contract_id: contract.id },
        },
        // One charge per contract per term even if this job is retried.
        { idempotencyKey: `plan-renewal-${contract.id}-${contract.end_date}` }
      );

      if (intent.status !== "succeeded") {
        errors.push(`contract ${contract.id}: charge not completed (status ${intent.status})`);
        continue;
      }

      // Charged. Roll the contract into its next term and clear the per-term
      // flags so next year's reminder and charge can fire. If this write
      // fails we still set auto_billed_at (the existing guard) so the card is
      // never charged twice for the same term.
      const billedAt = new Date().toISOString();
      const { error: renewError } = await supabase
        .from("service_contracts")
        .update({
          end_date: addOneYear(contract.end_date),
          auto_billed_at: null,
          renewal_reminder_sent_at: null,
          stripe_payment_method_id: paymentMethodId,
        })
        .eq("id", contract.id);
      if (renewError) {
        await supabase
          .from("service_contracts")
          .update({ auto_billed_at: billedAt, stripe_payment_method_id: paymentMethodId })
          .eq("id", contract.id);
        errors.push(
          `contract ${contract.id}: charged (${intent.id}) but term not extended: ${renewError.message}`
        );
      }
      console.info(`[maintenance-renewal] charged contract ${contract.id}, payment intent ${intent.id}`);
      charged++;
    } catch (err) {
      errors.push(`contract ${contract.id}: ${err instanceof Error ? err.message : "charge failed"}`);
    }
  }

  return { charged, skipped, errors };
}

