import { NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { supabase } from "@/lib/supabase";
import { flagReferralRewardIfEligible } from "@/lib/referral";

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

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const documentId = session.metadata?.document_id;
    const customerId = session.metadata?.customer_id;

    if (documentId) {
      const { data: updatedDoc, error } = await supabase
        .from("documents")
        .update({ status: "paid", paid_at: new Date().toISOString() })
        .eq("id", documentId)
        .select("type, customer_id")
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      if (updatedDoc?.customer_id) {
        await flagReferralRewardIfEligible(updatedDoc.customer_id, updatedDoc.type);
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
