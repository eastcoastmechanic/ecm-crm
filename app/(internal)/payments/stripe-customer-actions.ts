"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/require-role";
import { stripeMode } from "@/lib/stripe-customer-rules";
import { createStripeCustomers, emptyStripeCustomersResult, type StripeCustomersResult } from "@/lib/stripe-customers";

/** Owner only. dry_run=1 only counts; anything else creates Stripe customers. */
export async function runCreateStripeCustomers(
  _prev: StripeCustomersResult | null,
  formData: FormData
): Promise<StripeCustomersResult> {
  await requireOwner();
  const dryRun = formData.get("dry_run") === "1";
  if (!process.env.STRIPE_SECRET_KEY) {
    return { ...emptyStripeCustomersResult(dryRun), error: "STRIPE_SECRET_KEY is not set on Vercel." };
  }
  // Previews share the live database. Test-mode customer ids saved on live customers would break
  // live checkouts, renewals and card charges, so only a live key may write.
  if (!dryRun && stripeMode(process.env.STRIPE_SECRET_KEY) !== "live") {
    return {
      ...emptyStripeCustomersResult(dryRun),
      error: "This site's Stripe key is not a live key, and the CRM data is live. Run this on ecm-crm.vercel.app.",
    };
  }
  const result = await createStripeCustomers(dryRun);
  if (!dryRun && (result.created || result.reused)) {
    revalidatePath("/customers");
    revalidatePath("/payments");
  }
  return result;
}
