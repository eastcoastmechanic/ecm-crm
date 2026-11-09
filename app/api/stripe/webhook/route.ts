import { NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { supabase } from "@/lib/supabase";
import { markDocumentPaid } from "@/lib/document-paid";
import { centsToMoney, notifyOwnerOfMoney } from "@/lib/notify-owner";
import { REPLACE_STRIPE_CUSTOMER } from "@/lib/invoice-checkout";
import { formatEtDateTime } from "@/lib/tz";

type DocRow = {
  id?: string;
  doc_number: string | null;
  total?: number | string | null;
  status?: string | null;
  stripe_payment_intent_id?: string | null;
  payment_source?: string | null;
  customers?: { name: string | null } | { name: string | null }[] | null;
};

function customerName(doc: DocRow | null | undefined) {
  const c = Array.isArray(doc?.customers) ? doc?.customers[0] : doc?.customers;
  return c?.name ?? null;
}

/** "INV-1042, Pat Smith" style label; falls back to whatever is known. */
function docLabel(doc: DocRow | null | undefined, fallbackId?: string) {
  return [doc?.doc_number ?? fallbackId ?? null, customerName(doc)].filter(Boolean).join(", ");
}

function idOf(ref: string | { id: string } | null | undefined) {
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id;
}

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    return NextResponse.json({ error: "Missing webhook signature or secret" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const failed = await handleCheckoutPaid(event.data.object as Stripe.Checkout.Session);
    if (failed) return NextResponse.json({ error: failed }, { status: 500 });
  } else if (event.type === "charge.refunded") {
    await handleRefund(event.data.object as Stripe.Charge);
  } else if (event.type === "charge.dispute.created") {
    await handleDispute(event.data.object as Stripe.Dispute);
  }

  // Every other event type, and every alert above, answers 200 so Stripe does
  // not retry forever.
  return NextResponse.json({ received: true });
}

/** Returns an error message when Stripe should retry, otherwise null. */
async function handleCheckoutPaid(session: Stripe.Checkout.Session): Promise<string | null> {
  const documentId = session.metadata?.document_id;
  const customerId = session.metadata?.customer_id;
  const paymentIntentId = idOf(session.payment_intent as string | { id: string } | null);

  // Only money actually received marks an invoice paid. Delayed-payment
  // sessions complete unpaid and arrive again as async_payment_succeeded.
  if (documentId && session.payment_status === "paid") {
    const { data: doc, error: docError } = await supabase
      .from("documents")
      .select("doc_number, total, customers(name)")
      .eq("id", documentId)
      .single();

    if (docError) return docError.message;

    const paidCents = session.amount_total ?? 0;
    const expectedCents = Math.round(Number(doc?.total ?? 0) * 100);
    if (Math.abs(paidCents - expectedCents) > 1) {
      // Money was taken but does not match the invoice (edited after the
      // link went out, or a partial amount). Do not mark it paid; a human
      // reconciles. Respond 200 so Stripe does not retry forever.
      console.error(
        `[stripe-webhook] amount mismatch for document ${documentId}: paid ${paidCents}c, invoice ${expectedCents}c (session ${session.id})`
      );
      await notifyOwnerOfMoney({
        title: `Stripe payment does not match the invoice (${docLabel(doc as DocRow, documentId)})`,
        body: `The customer paid ${centsToMoney(paidCents)} but the invoice is ${centsToMoney(expectedCents)}. The invoice was NOT marked paid. Check it in the CRM and in Stripe (payment ${paymentIntentId ?? session.id}).`,
        path: `/documents/${documentId}`,
      });
    } else {
      const result = await markDocumentPaid(documentId, {
        source: "stripe",
        stripePaymentIntentId: paymentIntentId,
      });
      if (result.error) return result.error;
      if (!result.updated) await checkSecondPayment(documentId, paymentIntentId, paidCents);
    }
  }

  return saveStripeCustomer(session, customerId);
}

/**
 * markDocumentPaid changed nothing, so the document was already paid. A replay
 * of the same payment is fine. A different payment (or one on a document paid
 * by cash, check or Square) means the customer may have paid twice.
 */
const PAID_BY: Record<string, string> = {
  stripe: "an earlier Stripe payment",
  square: "Square",
  manual: "hand in the CRM",
  cash_check: "cash or check",
};

async function checkSecondPayment(documentId: string, paymentIntentId: string | null, paidCents: number) {
  const { data: doc, error } = await supabase
    .from("documents")
    .select("doc_number, status, stripe_payment_intent_id, payment_source, customers(name)")
    .eq("id", documentId)
    .single();

  if (error) {
    // Better a false alarm than a missed double charge.
    console.error(`[stripe-webhook] could not re-read paid document ${documentId}: ${error.message}`);
  } else if (doc?.status !== "paid" || (paymentIntentId && doc.stripe_payment_intent_id === paymentIntentId)) {
    return;
  }

  const row = (doc ?? null) as DocRow | null;
  const before = row?.stripe_payment_intent_id
    ? `Stripe payment ${row.stripe_payment_intent_id}`
    : (PAID_BY[row?.payment_source ?? ""] ?? "an earlier payment");
  await notifyOwnerOfMoney({
    title: `Possible double payment, refund one (${docLabel(row, documentId)})`,
    body: `Stripe just took ${centsToMoney(paidCents)} (payment ${paymentIntentId ?? "unknown"}) for an invoice that was already marked paid by ${before}. Check both in Stripe and refund the extra one.`,
    path: `/documents/${documentId}`,
  });
}

/**
 * Keeps the Stripe customer that checkout used, so a saved card can be reused
 * for plan renewals. Never overwrites an existing id: plan renewals charge the
 * card saved on that customer (service_contracts.stripe_payment_method_id), and
 * swapping it would orphan that card. The one exception is a stored customer
 * that no longer exists in Stripe (lib/invoice-checkout.ts flags it); then the
 * old customer's saved card is cleared too, since it went with it.
 */
async function saveStripeCustomer(session: Stripe.Checkout.Session, customerId: string | undefined) {
  const stripeCustomerId = idOf(session.customer as string | { id: string } | null);
  if (!customerId || !stripeCustomerId) return null;

  const deadId = session.metadata?.[REPLACE_STRIPE_CUSTOMER];
  const base = supabase.from("customers").update({ stripe_customer_id: stripeCustomerId }).eq("id", customerId);
  const { data, error } = await (deadId ? base.eq("stripe_customer_id", deadId) : base.is("stripe_customer_id", null)).select(
    "id"
  );
  if (error) return `Could not save the Stripe customer: ${error.message}`;

  if (deadId && data && data.length > 0) {
    const { error: pmError } = await supabase
      .from("service_contracts")
      .update({ stripe_payment_method_id: null })
      .eq("customer_id", customerId)
      .not("stripe_payment_method_id", "is", null);
    if (pmError) return `Could not clear the old saved card: ${pmError.message}`;
  }
  return null;
}

/** Finds the CRM document (or plan) a Stripe payment belongs to, for alerts. Never throws. */
async function findPaymentTarget(paymentIntentId: string | null): Promise<{ label: string; path?: string }> {
  if (!paymentIntentId) return { label: "no payment id" };
  try {
    const { data: rows } = await supabase
      .from("documents")
      .select("id, doc_number, customers(name)")
      .eq("stripe_payment_intent_id", paymentIntentId)
      .limit(1);
    const doc = rows?.[0] as DocRow | undefined;
    if (doc?.id) return { label: docLabel(doc, doc.id), path: `/documents/${doc.id}` };

    // Not linked yet (or not an invoice payment): the payment's own metadata
    // says what it was for.
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const documentId = intent.metadata?.document_id;
    if (documentId) {
      const { data: byId } = await supabase
        .from("documents")
        .select("id, doc_number, customers(name)")
        .eq("id", documentId)
        .maybeSingle();
      return { label: docLabel(byId as DocRow | null, documentId), path: `/documents/${documentId}` };
    }
    if (intent.metadata?.service_contract_id) return { label: "plan renewal charge" };
    return { label: intent.description || `payment ${paymentIntentId}` };
  } catch (err) {
    console.error(
      `[stripe-webhook] could not look up payment ${paymentIntentId}:`,
      err instanceof Error ? err.message : err
    );
    return { label: `payment ${paymentIntentId}` };
  }
}

async function handleRefund(charge: Stripe.Charge) {
  const target = await findPaymentTarget(idOf(charge.payment_intent as string | { id: string } | null));
  const full = charge.amount_refunded >= charge.amount;
  await notifyOwnerOfMoney({
    title: `Stripe refund: ${centsToMoney(charge.amount_refunded)} (${target.label})`,
    body: `${full ? "Full refund" : "Partial refund"}: ${centsToMoney(charge.amount_refunded)} refunded so far of ${centsToMoney(charge.amount)}. The CRM did not change the invoice. Update it by hand if needed.`,
    path: target.path,
  });
}

async function handleDispute(dispute: Stripe.Dispute) {
  const target = await findPaymentTarget(idOf(dispute.payment_intent as string | { id: string } | null));
  const dueBy = dispute.evidence_details?.due_by
    ? ` Respond in the Stripe dashboard by ${formatEtDateTime(new Date(dispute.evidence_details.due_by * 1000))} ET.`
    : " Respond in the Stripe dashboard.";
  await notifyOwnerOfMoney({
    title: `Card dispute opened: ${centsToMoney(dispute.amount)} (${target.label})`,
    body: `The customer's bank opened a dispute (reason: ${dispute.reason.replace(/_/g, " ")}). Stripe has pulled the money back while it is open.${dueBy} The CRM did not change the invoice.`,
    path: target.path,
  });
}
