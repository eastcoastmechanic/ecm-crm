import { supabase } from "@/lib/supabase";
import {
  bulkRetrieveSquareCustomers,
  getSquareLocationId,
  isSquareConfigured,
  listSquareInvoices,
  listSquarePayments,
  type SquareCustomer,
  type SquareInvoice,
} from "@/lib/square";
import { markDocumentPaid } from "@/lib/document-paid";

export type SquareSyncResult = {
  invoicesUpserted: number;
  paymentsUpserted: number;
  customersLinked: number;
  documentsUpdated: number;
  /** Linked CRM documents whose Square invoice was refunded/canceled/failed. Not changed; needs a human look. */
  needsReview?: string[];
  error?: string;
};

type CrmCustomer = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  square_customer_id: string | null;
};

type CrmDocument = {
  id: string;
  doc_number: string | null;
  type: string;
  status: string;
  total: number | null;
  customer_id: string | null;
  square_invoice_id: string | null;
  paid_at: string | null;
};

function digitsPhone(raw: string | null | undefined) {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

function normalizeEmail(raw: string | null | undefined) {
  const value = (raw ?? "").trim().toLowerCase();
  return value || null;
}

function normalizeName(raw: string | null | undefined) {
  return (raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function squareCustomerName(customer: SquareCustomer | undefined, fallback?: string | null) {
  if (!customer) return fallback ?? null;
  const person = [customer.given_name, customer.family_name].filter(Boolean).join(" ").trim();
  return person || customer.company_name || fallback || null;
}

function invoiceTotals(invoice: SquareInvoice) {
  const requests = invoice.payment_requests ?? [];
  const total = requests.reduce((sum, req) => sum + (req.computed_amount_money?.amount ?? 0), 0);
  const paid = requests.reduce((sum, req) => sum + (req.total_completed_amount_money?.amount ?? 0), 0);
  const due = invoice.next_payment_amount_money?.amount ?? Math.max(total - paid, 0);
  const currency = requests[0]?.computed_amount_money?.currency ?? "USD";
  return { total, paid, due, currency };
}

function paidAtFromInvoice(invoice: SquareInvoice, paidCents: number) {
  if ((invoice.status ?? "") !== "PAID" || paidCents <= 0) return null;
  return invoice.updated_at ?? invoice.created_at ?? new Date().toISOString();
}

function matchCustomer(
  customers: CrmCustomer[],
  opts: { squareCustomerId?: string | null; email?: string | null; phone?: string | null; name?: string | null }
) {
  if (opts.squareCustomerId) {
    const bySquare = customers.find((c) => c.square_customer_id === opts.squareCustomerId);
    if (bySquare) return bySquare;
  }
  const email = normalizeEmail(opts.email);
  if (email) {
    const byEmail = customers.find((c) => normalizeEmail(c.email) === email);
    if (byEmail) return byEmail;
  }
  const phone = digitsPhone(opts.phone);
  if (phone.length === 10) {
    const byPhone = customers.find((c) => digitsPhone(c.phone) === phone);
    if (byPhone) return byPhone;
  }
  const name = normalizeName(opts.name);
  if (name) {
    const byName = customers.filter((c) => normalizeName(c.name) === name);
    if (byName.length === 1) return byName[0];
  }
  return null;
}

// Only strong matches link a CRM document to a Square invoice: the document is
// already linked to this exact Square invoice, or the invoice number equals the
// document number. Customer + same total is NOT enough: two unrelated jobs can
// share an amount, and a wrong link used to flip a paid invoice back to sent.
// No strong match leaves the Square invoice unlinked (visible, but not applied).
function matchDocument(documents: CrmDocument[], invoice: SquareInvoice) {
  if (!invoice.id) return null;
  const byId = documents.find((doc) => doc.square_invoice_id === invoice.id);
  if (byId) return byId;

  const invoiceNumber = invoice.invoice_number?.trim();
  if (!invoiceNumber) return null;
  return (
    documents.find(
      (doc) =>
        doc.type === "invoice" &&
        !doc.square_invoice_id &&
        (doc.doc_number ?? "").trim().toLowerCase() === invoiceNumber.toLowerCase()
    ) ?? null
  );
}

// Square states that mean the money did not stay received. We record them in
// square_invoices but never rewrite a CRM document's paid history from them.
const REVERSED_SQUARE_STATUSES = new Set(["REFUNDED", "PARTIALLY_REFUNDED", "CANCELED", "FAILED"]);

export async function syncSquarePayments(): Promise<SquareSyncResult> {
  if (!isSquareConfigured()) {
    return {
      invoicesUpserted: 0,
      paymentsUpserted: 0,
      customersLinked: 0,
      documentsUpdated: 0,
      error: "SQUARE_ACCESS_TOKEN is not set on Vercel.",
    };
  }

  const locationId = getSquareLocationId();
  const beginTime = new Date(Date.now() - 366 * 24 * 60 * 60 * 1000).toISOString();

  const [payments, invoices] = await Promise.all([
    listSquarePayments(beginTime),
    locationId ? listSquareInvoices(locationId) : Promise.resolve([] as SquareInvoice[]),
  ]);

  const squareCustomerIds = new Set<string>();
  for (const invoice of invoices) {
    const id = invoice.primary_recipient?.customer_id;
    if (id) squareCustomerIds.add(id);
  }
  for (const payment of payments) {
    if (payment.customer_id) squareCustomerIds.add(payment.customer_id);
  }

  const squareCustomers = await bulkRetrieveSquareCustomers([...squareCustomerIds]);

  const [{ data: crmCustomers, error: customerError }, { data: crmDocuments, error: documentError }] =
    await Promise.all([
      supabase.from("customers").select("id, name, email, phone, square_customer_id"),
      supabase
        .from("documents")
        .select("id, doc_number, type, status, total, customer_id, square_invoice_id, paid_at")
        .in("type", ["invoice", "estimate"]),
    ]);

  if (customerError) {
    return {
      invoicesUpserted: 0,
      paymentsUpserted: 0,
      customersLinked: 0,
      documentsUpdated: 0,
      error: customerError.message,
    };
  }
  if (documentError) {
    return {
      invoicesUpserted: 0,
      paymentsUpserted: 0,
      customersLinked: 0,
      documentsUpdated: 0,
      error: documentError.message,
    };
  }

  const customers = (crmCustomers ?? []) as CrmCustomer[];
  const documents = (crmDocuments ?? []) as CrmDocument[];
  const now = new Date().toISOString();

  let customersLinked = 0;
  const customerBySquareId = new Map<string, string>();
  const pendingCustomerLinks: Array<{ id: string; square_customer_id: string }> = [];

  function linkCustomer(opts: {
    squareCustomerId?: string | null;
    email?: string | null;
    phone?: string | null;
    name?: string | null;
  }) {
    if (opts.squareCustomerId && customerBySquareId.has(opts.squareCustomerId)) {
      return customerBySquareId.get(opts.squareCustomerId) ?? null;
    }
    const match = matchCustomer(customers, opts);
    if (!match) return null;
    if (opts.squareCustomerId) customerBySquareId.set(opts.squareCustomerId, match.id);
    if (opts.squareCustomerId && match.square_customer_id !== opts.squareCustomerId) {
      match.square_customer_id = opts.squareCustomerId;
      pendingCustomerLinks.push({ id: match.id, square_customer_id: opts.squareCustomerId });
      customersLinked += 1;
    }
    return match.id;
  }

  const invoiceRows: Record<string, unknown>[] = [];
  const documentLinks: Array<{ id: string; square_invoice_id: string }> = [];
  const draftToSent: string[] = [];
  const documentPaid: Array<{ id: string; paid_at: string }> = [];
  const needsReview: string[] = [];
  // Payment's own time (latest completed payment on the invoice's order).
  const completedPaymentAtByOrderId = new Map<string, string>();
  for (const payment of payments) {
    if (payment.status !== "COMPLETED" || !payment.order_id || !payment.created_at) continue;
    const prev = completedPaymentAtByOrderId.get(payment.order_id);
    if (!prev || payment.created_at > prev) completedPaymentAtByOrderId.set(payment.order_id, payment.created_at);
  }
  const invoiceIdByOrderId = new Map<string, string>();

  for (const invoice of invoices) {
    if (!invoice.id || !invoice.status) continue;
    const recipient = invoice.primary_recipient ?? {};
    const squareCustomer = recipient.customer_id ? squareCustomers.get(recipient.customer_id) : undefined;
    const displayName = squareCustomerName(
      squareCustomer,
      [recipient.given_name, recipient.family_name].filter(Boolean).join(" ").trim() || null
    );
    const email = recipient.email_address ?? squareCustomer?.email_address ?? null;
    const phone = recipient.phone_number ?? squareCustomer?.phone_number ?? null;
    const customerId = linkCustomer({
      squareCustomerId: recipient.customer_id ?? squareCustomer?.id ?? null,
      email,
      phone,
      name: displayName,
    });

    const totals = invoiceTotals(invoice);
    const paidAt =
      (invoice.order_id ? completedPaymentAtByOrderId.get(invoice.order_id) : null) ??
      paidAtFromInvoice(invoice, totals.paid);
    const matchedDoc = matchDocument(documents, invoice);
    if (invoice.order_id) invoiceIdByOrderId.set(invoice.order_id, invoice.id);

    invoiceRows.push({
      square_invoice_id: invoice.id,
      square_customer_id: recipient.customer_id ?? null,
      square_order_id: invoice.order_id ?? null,
      invoice_number: invoice.invoice_number ?? null,
      title: invoice.title ?? null,
      status: invoice.status,
      total_cents: totals.total,
      amount_paid_cents: totals.paid,
      amount_due_cents: totals.due,
      currency: totals.currency,
      public_url: invoice.public_url ?? null,
      square_customer_name: displayName,
      square_customer_email: email,
      square_customer_phone: phone,
      customer_id: customerId,
      document_id: matchedDoc?.id ?? null,
      square_created_at: invoice.created_at ?? null,
      paid_at: paidAt,
      synced_at: now,
    });

    if (!matchedDoc) continue;
    if (matchedDoc.square_invoice_id !== invoice.id) {
      matchedDoc.square_invoice_id = invoice.id;
      documentLinks.push({ id: matchedDoc.id, square_invoice_id: invoice.id });
    }

    if (invoice.status === "PAID") {
      if (matchedDoc.status !== "paid") {
        const when = paidAt ?? now;
        matchedDoc.status = "paid";
        matchedDoc.paid_at = when;
        documentPaid.push({ id: matchedDoc.id, paid_at: when });
      }
    } else if (REVERSED_SQUARE_STATUSES.has(invoice.status)) {
      if (matchedDoc.status === "paid") {
        needsReview.push(`${matchedDoc.doc_number ?? matchedDoc.id}: Square invoice ${invoice.status}`);
      }
    } else if (matchedDoc.status === "draft") {
      // Outstanding in Square (UNPAID/SCHEDULED/PARTIALLY_PAID): a CRM draft is
      // really out to the customer. Never touches a paid or already-sent document.
      draftToSent.push(matchedDoc.id);
      matchedDoc.status = "sent";
    }
  }

  const paymentRows: Record<string, unknown>[] = [];
  for (const payment of payments) {
    if (!payment.id || !payment.status) continue;
    const squareCustomer = payment.customer_id ? squareCustomers.get(payment.customer_id) : undefined;
    const customerId = linkCustomer({
      squareCustomerId: payment.customer_id ?? null,
      email: squareCustomer?.email_address ?? null,
      phone: squareCustomer?.phone_number ?? null,
      name: squareCustomerName(squareCustomer),
    });
    paymentRows.push({
      square_payment_id: payment.id,
      square_customer_id: payment.customer_id ?? null,
      square_order_id: payment.order_id ?? null,
      square_invoice_id: payment.order_id ? (invoiceIdByOrderId.get(payment.order_id) ?? null) : null,
      status: payment.status,
      amount_cents: payment.amount_money?.amount ?? 0,
      tip_cents: payment.tip_money?.amount ?? 0,
      total_cents: payment.total_money?.amount ?? payment.amount_money?.amount ?? 0,
      currency: payment.total_money?.currency ?? payment.amount_money?.currency ?? "USD",
      source_type: payment.source_type ?? null,
      card_brand: payment.card_details?.card?.card_brand ?? null,
      card_last4: payment.card_details?.card?.last_4 ?? null,
      receipt_url: payment.receipt_url ?? null,
      note: payment.note ?? null,
      customer_id: customerId,
      square_created_at: payment.created_at ?? null,
      synced_at: now,
    });
  }

  async function upsertChunks(table: string, rows: Record<string, unknown>[], conflict: string) {
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await supabase.from(table).upsert(rows.slice(i, i + 100), { onConflict: conflict });
      if (error) return error.message;
    }
    return null;
  }

  const invoiceError = await upsertChunks("square_invoices", invoiceRows, "square_invoice_id");
  if (invoiceError) {
    return {
      invoicesUpserted: 0,
      paymentsUpserted: 0,
      customersLinked,
      documentsUpdated: 0,
      error: invoiceError,
    };
  }

  const paymentError = await upsertChunks("square_payments", paymentRows, "square_payment_id");
  if (paymentError) {
    return {
      invoicesUpserted: invoiceRows.length,
      paymentsUpserted: 0,
      customersLinked,
      documentsUpdated: 0,
      error: paymentError,
    };
  }

  for (const link of pendingCustomerLinks) {
    await supabase.from("customers").update({ square_customer_id: link.square_customer_id }).eq("id", link.id);
  }

  let documentsUpdated = 0;
  for (const link of documentLinks) {
    const { error } = await supabase
      .from("documents")
      .update({ square_invoice_id: link.square_invoice_id })
      .eq("id", link.id);
    if (!error) documentsUpdated += 1;
  }
  for (const id of draftToSent) {
    const { error } = await supabase.from("documents").update({ status: "sent" }).eq("id", id).eq("status", "draft");
    if (!error) documentsUpdated += 1;
  }
  for (const paid of documentPaid) {
    const result = await markDocumentPaid(paid.id, { source: "square", paidAt: paid.paid_at });
    if (result.updated) documentsUpdated += 1;
  }

  return {
    invoicesUpserted: invoiceRows.length,
    paymentsUpserted: paymentRows.length,
    customersLinked,
    documentsUpdated,
    ...(needsReview.length ? { needsReview } : {}),
  };
}
