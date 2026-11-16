"use client";

import { useActionState } from "react";
import SubmitButton from "../SubmitButton";
import { buttonClass, buttonSecondaryClass, cardClass, errorClass, subTextClass } from "../ui";
import { runCreateStripeCustomers } from "./stripe-customer-actions";

/** Owner only. Preview, then give each CRM customer a Stripe customer record. */
export default function StripeCustomersPanel() {
  const [state, action] = useActionState(runCreateStripeCustomers, null);
  const modeText =
    state?.mode === "live" ? "Stripe LIVE mode: these are real Stripe customers." : state?.mode === "test" ? "Stripe test mode." : "";
  return (
    <section className={`${cardClass} flex flex-col gap-3`}>
      <div>
        <h2 className="font-display text-lg font-bold text-white">Create Stripe customers</h2>
        <p className={subTextClass}>
          Makes a Stripe customer for every CRM customer that doesn&apos;t have one yet and has an email or phone
          (name, email, phone, address if known), and saves the link on the customer. Payments and saved cards then
          land on that one Stripe record. No charge, no email from Stripe. Safe to run again: nothing is made twice.
        </p>
      </div>
      <form action={action} className="flex flex-wrap gap-2">
        <input type="hidden" name="dry_run" value="1" />
        <SubmitButton className={buttonSecondaryClass} pendingText="Counting…">
          Preview
        </SubmitButton>
      </form>
      {state?.error && <p className={errorClass}>{state.error}</p>}
      {state && !state.error && (
        <div className="text-sm text-g300">
          {modeText && <p>{modeText}</p>}
          {state.dryRun ? (
            <p>
              {state.total} CRM customers. {state.alreadyHave} already have a Stripe customer, {state.noContact} have no
              email or phone (skipped). Would create {state.willCreate}
              {state.willCreate > 100 ? " (100 per press)" : ""}.
            </p>
          ) : (
            <p>
              Created {state.created}, linked {state.reused} found already in Stripe
              {state.failed ? `; ${state.failed} failed (${state.failCodes.join(", ")}), run again to retry` : ""}
              {state.remaining ? `; ${state.remaining} left, press again` : ""}.
            </p>
          )}
        </div>
      )}
      {state && state.dryRun && !state.error && state.willCreate > 0 && (
        <form action={action}>
          <SubmitButton className={buttonClass} pendingText="Creating…">
            Create {Math.min(state.willCreate, 100)} Stripe customers
          </SubmitButton>
        </form>
      )}
    </section>
  );
}
