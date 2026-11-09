import { supabase } from "@/lib/supabase";
import { createDepositCheckoutSession, createInvoiceCheckoutSession } from "@/lib/invoice-checkout";
import { loadDepositContract, offeredDepositCents } from "@/lib/online-deposit";

/**
 * Staff-side Stripe checkout link for an invoice.
 *
 * The portal already has createCheckoutSession, but that one authenticates the
 * *customer* and redirects them straight into Stripe — it can't be reused from
 * the CRM or the assistant, which have no portal session. This builds the same
 * session server-side (lib/invoice-checkout.ts, shared with the portal) and
 * hands back the URL so a tech can text or email it.
 *
 * app/api/stripe/webhook/route.ts reads the session's document_id +
 * customer_id metadata to mark the invoice paid. A link that took money
 * without reconciling would be worse than no link at all.
 */

const SITE_ORIGIN = "https://eastcoastmechanical.org";

export async function createInvoicePaymentLink(documentId: string): Promise<{
  url: string;
  docNumber: string;
  total: number;
}> {
  const { data: doc, error } = await supabase
    .from("documents")
    .select("id, doc_number, type, status, total, customer_id")
    .eq("id", documentId)
    .single();

  if (error || !doc) throw new Error("Invoice not found");
  if (doc.type !== "invoice") throw new Error(`Only invoices can be paid online — this is a ${doc.type}.`);
  if (doc.status === "paid") throw new Error("That invoice is already paid.");
  if (!doc.total || doc.total <= 0) throw new Error("That invoice has no amount due.");

  const session = await createInvoiceCheckoutSession(doc, {
    success: `${SITE_ORIGIN}/portal/documents/${doc.id}?paid=1`,
    cancel: `${SITE_ORIGIN}/portal/documents/${doc.id}`,
  });

  if (!session.url) throw new Error("Stripe did not return a checkout URL");

  return {
    url: session.url,
    docNumber: doc.doc_number ?? doc.id,
    total: doc.total,
  };
}

/**
 * Staff-side Stripe checkout link for a signed contract's deposit. The amount
 * is the deposit in the signed terms (lib/online-deposit.ts), offered only
 * until a deposit is recorded. The webhook records it on the contract.
 */
export async function createDepositPaymentLink(documentId: string): Promise<{
  url: string;
  docNumber: string;
  depositCents: number;
}> {
  const { doc, ready, error } = await loadDepositContract(documentId);
  if (error) throw new Error("Couldn't read the contract. Try again.");
  if (!doc) throw new Error("Contract not found");
  if (!ready) throw new Error("Online deposits need SQL 0075 run first.");
  if (doc.type !== "contract") throw new Error("Deposits are only taken on contracts.");
  if (doc.status !== "signed") throw new Error("The customer has to sign the contract first.");
  if ((doc.deposit_received_cents ?? 0) > 0) throw new Error("A deposit is already recorded on this contract.");
  const depositCents = offeredDepositCents(doc, ready);
  if (depositCents == null) {
    throw new Error("The payment terms don't give a deposit amount, so it can't be paid online. Record it by hand.");
  }

  const session = await createDepositCheckoutSession(doc, depositCents, {
    success: `${SITE_ORIGIN}/portal/documents/${doc.id}?deposit=1`,
    cancel: `${SITE_ORIGIN}/portal/documents/${doc.id}`,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL");

  return { url: session.url, docNumber: doc.doc_number ?? doc.id, depositCents };
}
