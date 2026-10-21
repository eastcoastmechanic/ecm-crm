import { NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { supabase } from "@/lib/supabase";
import { markDocumentPaid } from "@/lib/document-paid";

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
    const session = event.data.object as Stripe.Checkout.Session;
    const documentId = session.metadata?.document_id;
    const customerId = session.metadata?.customer_id;

    // Only money actually received marks an invoice paid. Delayed-payment
    // sessions complete unpaid and arrive again as async_payment_succeeded.
    if (documentId && session.payment_status === "paid") {
      const { data: doc, error: docError } = await supabase
        .from("documents")
        .select("total")
        .eq("id", documentId)
        .single();

      if (docError) {
        return NextResponse.json({ error: docError.message }, { status: 500 });
      }

      const paidCents = session.amount_total ?? 0;
      const expectedCents = Math.round(Number(doc?.total ?? 0) * 100);
      if (Math.abs(paidCents - expectedCents) > 1) {
        // Money was taken but does not match the invoice (edited after the
        // link went out, or a partial amount). Do not mark it paid; a human
        // reconciles. Respond 200 so Stripe does not retry forever.
        console.error(
          `[stripe-webhook] amount mismatch for document ${documentId}: paid ${paidCents}c, invoice ${expectedCents}c (session ${session.id})`
        );
      } else {
        const paymentIntentId =
          typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);
        const result = await markDocumentPaid(documentId, {
          source: "stripe",
          stripePaymentIntentId: paymentIntentId,
        });
        if (result.error) {
          return NextResponse.json({ error: result.error }, { status: 500 });
        }
      }
    }

    // Captures the Stripe customer created for this checkout so a saved card
    // can be reused later for maintenance-plan renewal auto-billing.
    if (customerId && session.customer) {
      await supabase
        .from("customers")
        .update({ stripe_customer_id: session.customer as string })
        .eq("id", customerId);
    }
  }

  return NextResponse.json({ received: true });
}
