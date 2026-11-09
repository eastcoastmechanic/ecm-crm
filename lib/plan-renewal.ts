import { supabase } from "@/lib/supabase";
import { stripe } from "@/lib/stripe";
import { one } from "@/lib/appointment-reminder";
import { centsToMoney, notifyOwnerOfMoney } from "@/lib/notify-owner";
import { addDaysToDateKey, etDateKey, formatEtDate } from "@/lib/tz";
import { RENEWAL_CHARGE_WINDOW_DAYS, RENEWAL_NOTICE_MIN_DAYS, renewalChargeGate } from "@/lib/renewal-notice";

type PlanCustomer = { id: string; name: string | null; email: string | null; stripe_customer_id: string | null };

// Plans renew for one year; end_date is a plain YYYY-MM-DD.
export function addOneYear(isoDate: string) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Charges each auto-renew plan's saved card the week before it ends, then rolls it
 * forward a year. Only after this term's renewal notice went out at least
 * RENEWAL_NOTICE_MIN_DAYS earlier (lib/renewal-notice.ts). Without that, nothing is
 * charged and the owner is told.
 */
export async function sendMaintenancePlanCharges(now: Date = new Date()) {
  const today = etDateKey(now);

  const { data: contracts, error } = await supabase
    .from("service_contracts")
    .select(
      "id, plan_name, end_date, renewal_price_cents, renewal_reminder_sent_at, stripe_payment_method_id, customers(id, name, email, stripe_customer_id)"
    )
    .eq("status", "active")
    // Only contracts where the customer agreed to automatic renewal, at a price on the
    // contract (migration 0046). A saved card alone is NOT consent: checkout saves the
    // card for every online payment.
    .not("auto_renew_authorized_at", "is", null)
    .gt("renewal_price_cents", 0)
    .gte("end_date", today)
    .lte("end_date", addDaysToDateKey(today, RENEWAL_CHARGE_WINDOW_DAYS))
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

    const price = centsToMoney(contract.renewal_price_cents as number);
    const who = customer?.name ?? "A customer";
    const path = customer?.id ? `/customers/${customer.id}` : undefined;
    const notCharged = (reason: string) =>
      notifyOwnerOfMoney({
        title: `Plan renewal NOT charged: ${who}, ${price}`,
        body: `${reason} The plan ends ${contract.end_date}. The cron tries again every day until then.`,
        path,
      });

    // The contract promises a renewal email before each renewal. No notice for this
    // term, or one too recent, means no charge. The owner hears about it the day the
    // plan comes up for charging and again on the renewal date, not every day.
    const gate = renewalChargeGate({
      reminderSentAt: contract.renewal_reminder_sent_at as string | null,
      endDate: contract.end_date,
      now,
    });
    if (!gate.charge) {
      skipped++;
      const plan = contract.plan_name ?? "Service plan";
      const renews = formatEtDate(contract.end_date);
      const firstOrLastDay =
        contract.end_date === today || contract.end_date === addDaysToDateKey(today, RENEWAL_CHARGE_WINDOW_DAYS);
      if (gate.reason === "no_notice" && firstOrLastDay) {
        const why = customer?.email?.trim()
          ? "the renewal notice email has not gone out (the send failed or was not recorded)"
          : "no renewal notice could be sent (no email)";
        await notifyOwnerOfMoney({
          title: `Plan renewal NOT charged: ${who}, ${price}`,
          body: `${plan} for ${who} renews ${renews}: ${why}. Not charged. Call them or send it by hand. The plan stays active for the office to handle.`,
          path,
        });
      } else if (gate.reason === "notice_too_recent" && contract.end_date === today) {
        await notifyOwnerOfMoney({
          title: `Plan renewal NOT charged: ${who}, ${price}`,
          body: `${plan} for ${who} renews ${renews}: the renewal notice went out less than ${RENEWAL_NOTICE_MIN_DAYS} days ago, so the card was not charged. Call them to renew. The plan stays active for the office to handle.`,
          path,
        });
      }
      continue;
    }

    if (!customer?.stripe_customer_id) {
      skipped++;
      await notCharged("They agreed to auto-renew, but there is no card on file with Stripe.");
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
        await notCharged("They agreed to auto-renew, but there is no saved card to charge.");
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
        await notCharged(
          intent.status === "processing"
            ? `The charge is still processing at the bank (payment ${intent.id}). Check Stripe before doing anything.`
            : `Stripe did not complete the charge (status ${intent.status}, payment ${intent.id}). The customer may need to approve it or use another card.`
        );
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
      let problem: string | null = null;
      if (renewError) {
        const { error: guardError } = await supabase
          .from("service_contracts")
          .update({ auto_billed_at: billedAt, stripe_payment_method_id: paymentMethodId })
          .eq("id", contract.id);
        errors.push(
          `contract ${contract.id}: charged (${intent.id}) but term not extended: ${renewError.message}`
        );
        problem = `The plan's end date was NOT moved forward (${renewError.message}). Fix it on the contract.`;
        if (guardError) {
          // Neither write landed, so tomorrow's run could pick this contract up
          // again. The idempotency key only holds at Stripe for 24 hours.
          errors.push(`contract ${contract.id}: could not mark the term billed either: ${guardError.message}`);
          problem += ` It also could not be marked billed (${guardError.message}), so it may be charged AGAIN tomorrow. Fix it today.`;
        }
      }
      console.info(`[maintenance-renewal] charged contract ${contract.id}, payment intent ${intent.id}`);
      charged++;
      await notifyOwnerOfMoney({
        title: problem ? `Plan renewal charged, needs a fix: ${who}, ${price}` : `Plan renewal charged: ${who}, ${price}`,
        body: [
          `${contract.plan_name ?? "Service plan"} renewed for a year on the saved card (payment ${intent.id}).`,
          problem,
        ]
          .filter(Boolean)
          .join(" "),
        path,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "charge failed";
      errors.push(`contract ${contract.id}: ${reason}`);
      await notCharged(`The charge failed: ${reason}.`);
    }
  }

  return { charged, skipped, errors };
}

