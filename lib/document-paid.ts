import { supabase } from "@/lib/supabase";
import { flagReferralRewardIfEligible } from "@/lib/referral";
import { movePlannerTaskForJob } from "@/lib/planner-connector";
import { syncDocumentToGraph } from "@/lib/graph-connector";

export type PaymentSource = "stripe" | "square" | "manual" | "cash_check";

/**
 * The one place a document becomes "paid". Used by the Stripe webhook, the
 * Square sync and the manual status change so all three do the same thing.
 *
 * Idempotent: the update only matches a document that is not already paid, so
 * a webhook replay or a repeat sync never rewrites paid_at or re-runs the
 * post-paid steps. Returns `updated: false` when nothing changed.
 *
 * Needs migration 0042 for payment_source / stripe_payment_intent_id. If those
 * columns are not there yet it retries with status + paid_at only.
 */
export async function markDocumentPaid(
  documentId: string,
  opts: { source: PaymentSource; paidAt?: string | null; stripePaymentIntentId?: string | null }
): Promise<{ updated: boolean; error?: string }> {
  const paidAt = opts.paidAt ?? new Date().toISOString();
  const base = { status: "paid", paid_at: paidAt };
  const full = {
    ...base,
    payment_source: opts.source,
    ...(opts.stripePaymentIntentId ? { stripe_payment_intent_id: opts.stripePaymentIntentId } : {}),
  };

  async function run(values: Record<string, unknown>) {
    return supabase
      .from("documents")
      .update(values)
      .eq("id", documentId)
      .or("status.is.null,status.neq.paid")
      .select("type, customer_id, job_id");
  }

  let { data, error } = await run(full);
  if (error && /payment_source|stripe_payment_intent_id/.test(error.message)) {
    console.warn("[document-paid] migration 0042 not applied; storing status/paid_at only");
    ({ data, error } = await run(base));
  }
  if (error) return { updated: false, error: error.message };

  const doc = data?.[0];
  if (!doc) return { updated: false };

  // Post-paid steps. A failure here must not undo or fail the payment record.
  try {
    if (doc.customer_id) await flagReferralRewardIfEligible(doc.customer_id, doc.type);
    if (doc.type === "invoice" && doc.job_id) await movePlannerTaskForJob(doc.job_id, "billed");
    await syncDocumentToGraph(documentId);
  } catch (err) {
    console.error(`[document-paid] post-paid steps failed for ${documentId}:`, err);
  }

  return { updated: true };
}
