"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createPortalServerClient } from "@/lib/supabase-portal/server";
import { stripe } from "@/lib/stripe";
import { supabase as adminDb } from "@/lib/supabase";
import type { ContractLineItems } from "@/lib/contract-terms";

export async function createCheckoutSession(formData: FormData) {
  const documentId = formData.get("document_id") as string;
  const supabase = await createPortalServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/portal/login");

  const { data: doc, error } = await supabase
    .from("documents")
    .select("id, doc_number, type, status, total, customer_id")
    .eq("id", documentId)
    .single();

  if (error || !doc) throw new Error("Invoice not found");
  if (doc.type !== "invoice") throw new Error("Only invoices can be paid online");
  if (doc.status === "paid") throw new Error("This invoice is already paid");
  if (!doc.total || doc.total <= 0) throw new Error("This invoice has no amount due");

  const origin = (await headers()).get("origin");

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: Math.round(doc.total * 100),
          product_data: {
            name: `Invoice ${doc.doc_number ?? doc.id} — East Coast Mechanical`,
          },
        },
        quantity: 1,
      },
    ],
    // Saves the card against a Stripe customer so future maintenance-plan
    // renewals can be charged off-session without asking again.
    customer_creation: "always",
    payment_intent_data: {
      setup_future_usage: "off_session",
    },
    metadata: {
      document_id: doc.id,
      customer_id: doc.customer_id,
    },
    success_url: `${origin}/portal/documents/${doc.id}?paid=1`,
    cancel_url: `${origin}/portal/documents/${doc.id}`,
  });

  if (!session.url) throw new Error("Could not start checkout session");
  redirect(session.url);
}

export async function approveEstimate(formData: FormData) {
  const documentId = formData.get("document_id") as string;
  const signatureData = formData.get("signature_data") as string;
  const supabase = await createPortalServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/portal/login");

  if (!signatureData) throw new Error("A signature is required to approve this estimate");

  const { data: doc, error } = await supabase
    .from("documents")
    .select("id, type, status")
    .eq("id", documentId)
    .single();

  if (error || !doc) throw new Error("Estimate not found");
  if (doc.type !== "estimate") throw new Error("Only estimates can be approved");
  if (doc.status !== "sent") throw new Error("This estimate can't be approved right now");

  const { error: updateError } = await supabase
    .from("documents")
    .update({
      status: "approved",
      signed_at: new Date().toISOString(),
      signature_data: signatureData,
    })
    .eq("id", documentId);

  if (updateError) throw new Error(updateError.message);

  redirect(`/portal/documents/${documentId}?approved=1`);
}

export async function signContract(formData: FormData) {
  const documentId = formData.get("document_id") as string;
  const signatureData = formData.get("signature_data") as string;
  const agreed = formData.get("agreed") === "on";
  const supabase = await createPortalServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/portal/login");

  if (!signatureData) throw new Error("A signature is required to sign this contract");
  if (!agreed) throw new Error("You must confirm you've read and agree to the contract terms");

  const { data: doc, error } = await supabase
    .from("documents")
    .select("id, type, status, customer_id, property_id, line_items")
    .eq("id", documentId)
    .single();

  if (error || !doc) throw new Error("Contract not found");
  if (doc.type !== "contract") throw new Error("Only contracts can be signed here");
  if (doc.status !== "sent") throw new Error("This contract can't be signed right now");

  const requestHeaders = await headers();
  const signerIp = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const signerUserAgent = requestHeaders.get("user-agent");

  // Automatic renewal is only honored when the contract offered it AND the customer ticked the box.
  const lineItems = (doc.line_items ?? {}) as ContractLineItems;
  const renewalCents = lineItems.autoRenewPriceCents ?? null;
  const authorizeRenewal = formData.get("auto_renew") === "on" && !!renewalCents && renewalCents > 0;
  const signedAt = new Date().toISOString();

  const { data: signed, error: updateError } = await supabase
    .from("documents")
    .update({
      status: "signed",
      signed_at: signedAt,
      signature_data: signatureData,
      signer_ip: signerIp,
      signer_user_agent: signerUserAgent,
      ...(authorizeRenewal ? { line_items: { ...lineItems, autoRenewAuthorizedAt: signedAt } } : {}),
    })
    .eq("id", documentId)
    .eq("status", "sent")
    .select("id");

  if (updateError) throw new Error(updateError.message);
  if (!signed || signed.length === 0) throw new Error("This contract can't be signed right now");

  // Record the consent on the customer's active plan (the renewal cron charges only these).
  // Never fails the signing: the authorization is also stored on the signed contract above.
  if (authorizeRenewal && doc.customer_id && doc.property_id) {
    // Only when exactly one active plan matches: with several, one consent must not authorize them all.
    const { data: plans, error: planError } = await adminDb
      .from("service_contracts")
      .select("id")
      .eq("customer_id", doc.customer_id)
      .eq("property_id", doc.property_id)
      .eq("status", "active");
    if (planError) {
      console.error(`Could not look up plan for renewal authorization: ${planError.message}`);
    } else if (plans?.length === 1) {
      const { error: setError } = await adminDb
        .from("service_contracts")
        .update({ auto_renew_authorized_at: signedAt, renewal_price_cents: renewalCents })
        .eq("id", plans[0].id);
      if (setError) console.error(`Could not record renewal authorization on plan: ${setError.message}`);
    } else {
      console.error(`Renewal authorization on contract ${documentId} not applied: ${plans?.length ?? 0} active plans match`);
    }
  }

  redirect(`/portal/documents/${documentId}?signed=1`);
}
