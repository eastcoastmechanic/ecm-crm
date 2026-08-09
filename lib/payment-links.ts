import { stripe } from "@/lib/stripe";
import { supabase } from "@/lib/supabase";

/**
 * Staff-side Stripe checkout link for an invoice.
 *
 * The portal already has createCheckoutSession, but that one authenticates the
 * *customer* and redirects them straight into Stripe — it can't be reused from
 * the CRM or the assistant, which have no portal session. This builds the same
 * session server-side and hands back the URL so a tech can text or email it.
 *
 * The metadata below is deliberately identical to the portal's
 * (document_id + customer_id): app/api/stripe/webhook/route.ts reads exactly
 * those to mark the invoice paid. A link that took money without reconciling
 * would be worse than no link at all.
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
    customer_creation: "always",
    payment_intent_data: { setup_future_usage: "off_session" },
    metadata: {
      document_id: doc.id,
      customer_id: doc.customer_id,
    },
    success_url: `${SITE_ORIGIN}/portal/documents/${doc.id}?paid=1`,
    cancel_url: `${SITE_ORIGIN}/portal/documents/${doc.id}`,
  });

  if (!session.url) throw new Error("Stripe did not return a checkout URL");

  return {
    url: session.url,
    docNumber: doc.doc_number ?? doc.id,
    total: doc.total,
  };
}
