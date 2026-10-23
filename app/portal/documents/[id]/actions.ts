"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createPortalServerClient } from "@/lib/supabase-portal/server";
import { stripe } from "@/lib/stripe";
import { supabase as adminDb } from "@/lib/supabase";
import type { ContractLineItems } from "@/lib/contract-terms";
import { etDateKey } from "@/lib/tz";
import { notifyOwnerOfEvent } from "@/lib/notify-owner";

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

  const { data: approved, error: updateError } = await supabase
    .from("documents")
    .update({
      status: "approved",
      signed_at: new Date().toISOString(),
      signature_data: signatureData,
    })
    .eq("id", documentId)
    .eq("status", "sent")
    .select("id");

  if (updateError) throw new Error(updateError.message);
  if (!approved || approved.length === 0) throw new Error("This estimate can't be approved right now");

  await notifyOwnerOfEvent("estimate_approved", documentId);

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

  await notifyOwnerOfEvent("contract_signed", documentId);

  // A contract that offers yearly renewal is a maintenance plan: make sure the customer has an active plan
  // record for this property, and record renewal consent on it. Never fails the signing: the authorization
  // is also stored on the signed contract above.
  if (renewalCents && renewalCents > 0 && doc.customer_id && doc.property_id) {
    try {
      const { data: plans, error: planError } = await adminDb
        .from("service_contracts")
        .select("id")
        .eq("customer_id", doc.customer_id)
        .eq("property_id", doc.property_id)
        .eq("status", "active");
      if (planError) throw new Error(planError.message);

      const consent = authorizeRenewal ? { auto_renew_authorized_at: signedAt, renewal_price_cents: renewalCents } : {};
      if (!plans || plans.length === 0) {
        const start = etDateKey(new Date(signedAt));
        const end = new Date(`${start}T12:00:00Z`);
        end.setUTCFullYear(end.getUTCFullYear() + 1);
        const { error: createError } = await adminDb.from("service_contracts").insert({
          customer_id: doc.customer_id,
          property_id: doc.property_id,
          plan_name: "Annual Maintenance Plan",
          start_date: start,
          end_date: end.toISOString().slice(0, 10),
          status: "active",
          terms: `Created automatically when contract ${documentId} was signed.`,
          ...consent,
        });
        if (createError) throw new Error(createError.message);
      } else if (plans.length === 1) {
        // With several plans, one consent must not authorize them all, so only a single match is updated.
        if (authorizeRenewal) {
          const { error: setError } = await adminDb.from("service_contracts").update(consent).eq("id", plans[0].id);
          if (setError) throw new Error(setError.message);
        }
      } else {
        console.error(`Contract ${documentId} signed: ${plans.length} active plans match, none changed`);
      }
    } catch (err) {
      console.error(`Could not create or update maintenance plan for contract ${documentId}: ${err instanceof Error ? err.message : err}`);
    }
  }

  redirect(`/portal/documents/${documentId}?signed=1`);
}
