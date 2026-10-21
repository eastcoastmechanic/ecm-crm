"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import {
  createSquareDraftInvoice,
  createSquareOrder,
  findOrCreateSquareCustomer,
  getSquareLocationId,
  isSquareConfigured,
} from "@/lib/square";
import {
  depositSplit,
  idempotencyKey,
  mapLineItems,
  paymentRequests,
  type StoredDocument,
} from "@/lib/estimate-routing";

export type RouteResult = { error?: string; ok?: boolean };

function refresh() {
  revalidatePath("/documents/inbox");
  revalidatePath("/documents");
}

// "Create in CRM": keep the estimate in the CRM as a draft. Nothing is sent
// to the customer; Josh sends it from the document page when he's ready.
export async function routeToCrm(documentId: string): Promise<RouteResult> {
  if (!documentId) return { error: "Missing document id." };

  const { data: doc, error: readError } = await supabase
    .from("documents")
    .select("id, routed_to")
    .eq("id", documentId)
    .eq("type", "estimate")
    .maybeSingle();
  if (readError) return { error: readError.message };
  if (!doc) return { error: "Estimate not found." };
  if (doc.routed_to === "crm") return { ok: true };
  if (doc.routed_to === "square") return { error: "Already sent to Square." };

  const { error } = await supabase
    .from("documents")
    .update({ routed_to: "crm", routed_at: new Date().toISOString() })
    .eq("id", documentId)
    .is("routed_to", null);
  if (error) return { error: error.message };

  refresh();
  return { ok: true };
}

type DocRow = StoredDocument & {
  id: string;
  status: string | null;
  routed_to: string | null;
  square_invoice_id: string | null;
  customer_id: string | null;
  customers: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    square_customer_id: string | null;
  } | null;
};

// "Create in Square": customer + order + DRAFT invoice. Never published or
// sent; Josh reviews and sends it from Square. routed_to is only set after
// Square confirms the invoice, and every Square call uses an idempotency key
// derived from the document id, so a retry or double-tap can't duplicate.
export async function routeToSquare(documentId: string): Promise<RouteResult> {
  if (!documentId) return { error: "Missing document id." };

  const { data, error: readError } = await supabase
    .from("documents")
    .select(
      "id, doc_number, status, subtotal, tax, total, line_items, routed_to, square_invoice_id, customer_id, customers(id, name, email, phone, square_customer_id)"
    )
    .eq("id", documentId)
    .eq("type", "estimate")
    .maybeSingle();
  if (readError) return { error: readError.message };
  if (!data) return { error: "Estimate not found." };
  const doc = data as unknown as DocRow;

  if (doc.routed_to === "square") return { ok: true };
  if (doc.routed_to === "crm") return { error: "Already kept in the CRM." };
  // Only drafts go to Square. A stale inbox must not invoice something already sent or paid.
  if (doc.status !== "draft") {
    return { error: `This estimate is already ${doc.status ?? "processed"}. Refresh the list.` };
  }
  if (doc.square_invoice_id) {
    // A Square invoice is already linked (e.g. by the sync). Just record the routing.
    await supabase
      .from("documents")
      .update({ routed_to: "square", routed_at: new Date().toISOString() })
      .eq("id", doc.id)
      .is("routed_to", null);
    refresh();
    return { ok: true };
  }

  if (!isSquareConfigured()) return { error: "Square isn't set up yet (no access token on Vercel)." };
  const locationId = getSquareLocationId();
  if (!locationId) return { error: "Square location isn't set (SQUARE_LOCATION_ID on Vercel)." };

  const lines = mapLineItems(doc);
  if (!lines.ok) return { error: lines.error };

  const customer = doc.customers;
  if (!customer) return { error: "This estimate has no customer. Open it and add one first." };

  let squareCustomerId = customer.square_customer_id;
  if (!squareCustomerId) {
    const found = await findOrCreateSquareCustomer({
      idempotencyKey: idempotencyKey("cus", customer.id),
      referenceId: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
    });
    if (!found.ok) return { error: found.error };
    squareCustomerId = found.value;
    // Best effort; the sync pass links customers too. Unique index may reject a duplicate.
    await supabase.from("customers").update({ square_customer_id: squareCustomerId }).eq("id", customer.id);
  }

  const order = await createSquareOrder({
    idempotencyKey: idempotencyKey("ord", doc.id),
    locationId,
    customerId: squareCustomerId,
    referenceId: doc.doc_number ?? doc.id,
    lineItems: lines.lines,
  });
  if (!order.ok) return { error: order.error };

  const split = depositSplit(lines.totalCents, doc.line_items?.deposit_percent);
  const today = new Date().toISOString().slice(0, 10);
  const invoice = await createSquareDraftInvoice({
    idempotencyKey: idempotencyKey("inv", doc.id),
    locationId,
    orderId: order.value,
    customerId: squareCustomerId,
    title: `Estimate ${doc.doc_number ?? ""}`.trim(),
    hasEmail: Boolean(customer.email?.trim()),
    paymentRequests: paymentRequests(split, today),
  });
  if (!invoice.ok) return { error: invoice.error };

  const { data: saved, error: saveError } = await supabase
    .from("documents")
    .update({
      square_invoice_id: invoice.value,
      routed_to: "square",
      routed_at: new Date().toISOString(),
    })
    .eq("id", doc.id)
    .is("routed_to", null)
    .select("id");
  if (saveError) {
    return {
      error: `Draft invoice is in Square but the CRM couldn't save the link (${saveError.message}). Tap again to retry; it won't duplicate.`,
    };
  }
  if (!saved || saved.length === 0) {
    // Someone routed this estimate in another tab while Square was working. Never lose the
    // link to the invoice we just created: store it, then tell Josh plainly.
    await supabase
      .from("documents")
      .update({ square_invoice_id: invoice.value })
      .eq("id", doc.id)
      .is("square_invoice_id", null);
    refresh();
    return {
      error:
        "This estimate was routed in another tab while the Square draft was being made. The draft invoice exists in Square and is linked here; delete it in Square if you don't want it.",
    };
  }

  refresh();
  return { ok: true };
}
