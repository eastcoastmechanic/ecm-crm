"use server";

import { redirect } from "next/navigation";
import { DEFAULT_VISIT_MONTHS } from "@/lib/maintenance-visits";
import { headers } from "next/headers";
import { createPortalServerClient } from "@/lib/supabase-portal/server";
import { createInvoiceCheckoutSession } from "@/lib/invoice-checkout";
import { supabase as adminDb } from "@/lib/supabase";
import type { ContractLineItems } from "@/lib/contract-terms";
import { etDateKey } from "@/lib/tz";
import { notifyOwnerOfEvent } from "@/lib/notify-owner";
import { approvalChoice, type TierTotals } from "@/lib/estimate-tier";
import { portalCustomerFor } from "@/lib/portal-customer";
import { isSignatureImage } from "@/lib/portal-view";

export type PayState = { error?: string } | null;

/** Pay Now on an invoice. Returns { error } (production builds hide a thrown message from the customer). */
export async function createCheckoutSession(_prev: PayState, formData: FormData): Promise<PayState> {
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

  if (error || !doc) return { error: "We couldn't find this invoice. Refresh the page and try again." };
  if (doc.type !== "invoice") return { error: "Only invoices can be paid online." };
  if (doc.status === "paid") return { error: "This invoice is already paid." };
  if (!doc.total || doc.total <= 0) return { error: "This invoice has no amount due." };

  // Some browsers send no Origin header; fall back to the app address so Stripe gets a real return link.
  const origin = (await headers()).get("origin") ?? (process.env.NEXT_PUBLIC_APP_URL ?? "https://ecm-crm.vercel.app").replace(/\/$/, "");

  let checkoutUrl: string | null = null;
  try {
    // Shared with the staff payment link. Reuses the customer's Stripe record
    // when they have one, so the card that plan renewals charge stays on it.
    const session = await createInvoiceCheckoutSession(doc, {
      success: `${origin}/portal/documents/${doc.id}?paid=1`,
      cancel: `${origin}/portal/documents/${doc.id}`,
    });
    checkoutUrl = session.url;
  } catch (err) {
    console.error("createCheckoutSession: Stripe failed", err instanceof Error ? err.message : err);
  }
  if (!checkoutUrl) return { error: "We couldn't open the payment page. Please try again in a minute, or call us." };
  redirect(checkoutUrl);
}

/**
 * Customer approves an estimate in the portal. On a Good/Better/Best estimate
 * they must pick one; the pick is stored in documents.selected_tier and the
 * document total becomes that option's total, so the owner alert and the
 * contract made from it carry the right price. Returns { error } (production
 * builds hide a thrown message from the customer).
 */
export async function approveEstimate(formData: FormData): Promise<{ error?: string }> {
  const documentId = formData.get("document_id") as string;
  const signatureData = formData.get("signature_data") as string;
  const supabase = await createPortalServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/portal/login");

  if (!signatureData) return { error: "A signature is required to approve this estimate." };
  if (!isSignatureImage(signatureData)) return { error: "We couldn't read your signature. Please clear it and sign again." };

  // Reads and writes go through the service client, scoped to this customer's
  // own sent estimate. The customer's session can't write documents (SQL 0070).
  const customer = await portalCustomerFor(user.id);
  if (!customer) return { error: "Estimate not found." };

  const { data: doc, error } = await adminDb
    .from("documents")
    .select("id, type, status, line_items")
    .eq("id", documentId)
    .eq("customer_id", customer.id)
    .maybeSingle();

  if (error || !doc) return { error: "Estimate not found." };
  if (doc.type !== "estimate") return { error: "Only estimates can be approved." };
  if (doc.status !== "sent") return { error: "This estimate can't be approved right now." };

  const lineItems = (doc.line_items ?? {}) as { pricing_mode?: string | null; totals?: TierTotals | null };
  const choice = approvalChoice(lineItems, formData.get("tier"));
  if (!choice.ok) return { error: choice.error };

  const changed = "This estimate was just updated. Refresh the page, check the price and sign again.";
  // The price the customer was shown must still be the price on file.
  if (choice.tier) {
    const seen = Number(formData.get("tier_total"));
    if (!Number.isFinite(seen) || Math.abs(seen - choice.total) > 0.005) return { error: changed };
  }

  // Only these columns are written; line_items never is, so an office edit saved meanwhile is kept.
  // The conditions make a double press or a race apply once.
  let update = adminDb
    .from("documents")
    .update({
      status: "approved",
      signed_at: new Date().toISOString(),
      signature_data: signatureData,
      ...(choice.tier ? { selected_tier: choice.tier, subtotal: choice.total, tax: 0, total: choice.total } : {}),
    })
    .eq("id", documentId)
    .eq("customer_id", customer.id)
    .eq("type", "estimate")
    .eq("status", "sent");
  // And the chosen option's price must not have changed between the read above and this write.
  if (choice.tier) update = update.eq(`line_items->totals->>${choice.tier}`, String(choice.total));
  const { data: approved, error: updateError } = await update.select("id");

  if (updateError) return { error: "Couldn't save your approval. Please try again." };
  if (!approved || approved.length === 0) return { error: choice.tier ? changed : "This estimate can't be approved right now." };

  await notifyOwnerOfEvent("estimate_approved", documentId);

  redirect(`/portal/documents/${documentId}?approved=1`);
}

/** Customer signs a contract. Returns { error } so the message reaches them (a thrown one is hidden in production). */
export async function signContract(formData: FormData): Promise<{ error?: string }> {
  const documentId = formData.get("document_id") as string;
  const signatureData = formData.get("signature_data") as string;
  const agreed = formData.get("agreed") === "on";
  const supabase = await createPortalServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/portal/login");

  if (!signatureData) return { error: "A signature is required to sign this contract." };
  if (!agreed) return { error: "Please tick the box to confirm you've read and agree to the contract terms." };
  if (!isSignatureImage(signatureData)) return { error: "We couldn't read your signature. Please clear it and sign again." };

  // Reads and writes go through the service client, scoped to this customer's
  // own sent contract. The customer's session can't write documents (SQL 0070).
  const customer = await portalCustomerFor(user.id);
  if (!customer) return { error: "We couldn't find this contract. Refresh the page and try again." };

  const { data: doc, error } = await adminDb
    .from("documents")
    .select("id, type, status, total, customer_id, property_id, line_items")
    .eq("id", documentId)
    .eq("customer_id", customer.id)
    .maybeSingle();

  if (error || !doc) return { error: "We couldn't find this contract. Refresh the page and try again." };
  if (doc.type !== "contract") return { error: "Only contracts can be signed here." };
  if (doc.status !== "sent") return { error: "This contract can't be signed right now. Refresh the page to see its status." };

  const requestHeaders = await headers();
  const signerIp = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const signerUserAgent = requestHeaders.get("user-agent");

  // Automatic renewal is only honored when the contract offered it AND the customer ticked the box.
  const lineItems = (doc.line_items ?? {}) as ContractLineItems;
  const renewalCents = lineItems.autoRenewPriceCents ?? null;
  const authorizeRenewal = formData.get("auto_renew") === "on" && !!renewalCents && renewalCents > 0;
  const signedAt = new Date().toISOString();

  // Only these columns are written. The conditions make a double press or a race apply once, and refuse
  // the signature if the contract price changed between the read above and this write.
  let update = adminDb
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
    .eq("customer_id", customer.id)
    .eq("type", "contract")
    .eq("status", "sent");
  update = doc.total === null ? update.is("total", null) : update.eq("total", doc.total);
  const { data: signed, error: updateError } = await update.select("id");

  if (updateError) {
    console.error("signContract: update failed", updateError.message);
    return { error: "Couldn't save your signature. Please try again." };
  }
  if (!signed || signed.length === 0) return { error: "This contract can't be signed right now. Refresh the page to see its status." };

  await notifyOwnerOfEvent("contract_signed", documentId);

  // A contract that offers yearly renewal is a maintenance plan: make sure the customer has an active plan
  // record for this property, and record renewal consent on it. Never fails the signing: the authorization
  // is also stored on the signed contract above.
  if (renewalCents && renewalCents > 0 && doc.customer_id && doc.property_id) {
    try {
      const { data: plans, error: planError } = await adminDb
        .from("service_contracts")
        .select("id, visit_months")
        .eq("customer_id", doc.customer_id)
        .eq("property_id", doc.property_id)
        .eq("status", "active");
      if (planError) throw new Error(planError.message);

      // Months come from the contract. A contract that never set them gets Josh's default (April and October);
      // one saved with the field cleared (empty list) means no scheduled visits.
      const visitMonths = lineItems.visitMonths ?? DEFAULT_VISIT_MONTHS;
      const hasSchedule = visitMonths.length > 0;
      const consent = authorizeRenewal ? { auto_renew_authorized_at: signedAt, renewal_price_cents: renewalCents } : {};
      if (!plans || plans.length === 0) {
        const start = etDateKey(new Date(signedAt));
        const end = new Date(`${start}T12:00:00Z`);
        end.setUTCFullYear(end.getUTCFullYear() + 1);
        const { error: createError } = await adminDb.from("service_contracts").insert({
          customer_id: doc.customer_id,
          property_id: doc.property_id,
          plan_name: "Annual Maintenance Plan",
          visits_per_year: hasSchedule ? visitMonths.length : null,
          visit_months: hasSchedule ? visitMonths : null,
          start_date: start,
          end_date: end.toISOString().slice(0, 10),
          status: "active",
          terms: `Created automatically when contract ${documentId} was signed.`,
          ...consent,
        });
        if (createError) throw new Error(createError.message);
      } else if (plans.length === 1) {
        // With several plans, one consent must not authorize them all, so only a single match is updated.
        // Give an existing plan a visit schedule only if it has none; never overwrite one that was set.
        const schedule = plans[0].visit_months || !hasSchedule ? {} : { visits_per_year: visitMonths.length, visit_months: visitMonths };
        if (authorizeRenewal || Object.keys(schedule).length > 0) {
          const { error: setError } = await adminDb
            .from("service_contracts")
            .update({ ...consent, ...schedule })
            .eq("id", plans[0].id);
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
