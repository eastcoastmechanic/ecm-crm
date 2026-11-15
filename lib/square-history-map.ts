// Pure pieces of the Square full-history import (and a few helpers the regular
// sync shares). No database or network here, so it can be tested.
//
// The import walks a fixed list of "tasks": invoices per location, then payments
// and refunds per location per calendar year (UTC). Each server call does a few
// pages and returns where it stopped (task index + Square cursor), so a long
// history never runs into the function time limit and a stopped run can resume.

import type { SquareCustomer, SquareInvoice, SquareLocation, SquarePayment, SquareRefund } from "./square";

export function squareCustomerName(customer: SquareCustomer | undefined, fallback?: string | null) {
  if (!customer) return fallback ?? null;
  const person = [customer.given_name, customer.family_name].filter(Boolean).join(" ").trim();
  return person || customer.company_name || fallback || null;
}

export function invoiceTotals(invoice: SquareInvoice) {
  const requests = invoice.payment_requests ?? [];
  const total = requests.reduce((sum, req) => sum + (req.computed_amount_money?.amount ?? 0), 0);
  const paid = requests.reduce((sum, req) => sum + (req.total_completed_amount_money?.amount ?? 0), 0);
  const due = invoice.next_payment_amount_money?.amount ?? Math.max(total - paid, 0);
  const currency = requests[0]?.computed_amount_money?.currency ?? "USD";
  return { total, paid, due, currency };
}

export function paidAtFromInvoice(invoice: SquareInvoice, paidCents: number) {
  if ((invoice.status ?? "") !== "PAID" || paidCents <= 0) return null;
  return invoice.updated_at ?? invoice.created_at ?? new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Tasks and progress
// ---------------------------------------------------------------------------

export const HISTORY_KINDS = ["invoices", "payments", "refunds"] as const;
export type HistoryKind = (typeof HISTORY_KINDS)[number];

export type HistoryTask = {
  kind: HistoryKind;
  locationId: string;
  /** Payments and refunds only: one calendar year (UTC). */
  beginTime?: string;
  endTime?: string;
};

/** Used when Square gives no location start date. Square launched in 2009. */
export const HISTORY_FALLBACK_START = "2009-01-01T00:00:00.000Z";

/**
 * Every page-able piece of the account, in a fixed order, so the same list comes
 * back on every call and an index into it is a safe resume point. `now` is the
 * moment the run started (kept in the progress), not the time of each call.
 */
export function buildHistoryTasks(locations: SquareLocation[], now: string): HistoryTask[] {
  const located = locations
    .filter((l): l is SquareLocation & { id: string } => typeof l.id === "string" && l.id.length > 0)
    .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? "") || a.id.localeCompare(b.id));
  if (located.length === 0) return [];

  const nowMs = Date.parse(now);
  const starts = located.map((l) => Date.parse(l.created_at ?? "")).filter((ms) => Number.isFinite(ms) && ms <= nowMs);
  const earliest = starts.length ? Math.min(...starts) : Date.parse(HISTORY_FALLBACK_START);
  const firstYear = new Date(earliest).getUTCFullYear();
  const lastYear = new Date(nowMs).getUTCFullYear();

  const windows: Array<{ beginTime: string; endTime: string }> = [];
  for (let year = firstYear; year <= lastYear; year += 1) {
    const begin = Date.UTC(year, 0, 1);
    const end = Math.min(Date.UTC(year + 1, 0, 1), nowMs);
    if (end <= begin) continue;
    windows.push({ beginTime: new Date(begin).toISOString(), endTime: new Date(end).toISOString() });
  }

  const tasks: HistoryTask[] = [];
  for (const l of located) tasks.push({ kind: "invoices", locationId: l.id });
  for (const kind of ["payments", "refunds"] as const) {
    for (const l of located) for (const w of windows) tasks.push({ kind, locationId: l.id, ...w });
  }
  return tasks;
}

export type HistoryCount = { found: number; isNew: number };

export type HistoryProgress = {
  dryRun: boolean;
  /** When this run started; fixes the task list for every later call. */
  startedAt: string;
  taskIndex: number;
  cursor: string | null;
  totalTasks: number;
  counts: Record<HistoryKind, HistoryCount>;
  done: boolean;
};

export function emptyCounts(): Record<HistoryKind, HistoryCount> {
  return { invoices: { found: 0, isNew: 0 }, payments: { found: 0, isNew: 0 }, refunds: { found: 0, isNew: 0 } };
}

export function newHistoryProgress(dryRun: boolean, now: string): HistoryProgress {
  return { dryRun, startedAt: now, taskIndex: 0, cursor: null, totalTasks: 0, counts: emptyCounts(), done: false };
}

function wholeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * Progress comes back from the browser between calls, so it is checked like any
 * other form input. Returns null when it doesn't look like ours.
 */
export function parseHistoryProgress(raw: unknown): HistoryProgress | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.dryRun !== "boolean" || typeof r.done !== "boolean") return null;
  if (typeof r.startedAt !== "string" || !Number.isFinite(Date.parse(r.startedAt))) return null;
  const taskIndex = wholeNumber(r.taskIndex);
  const totalTasks = wholeNumber(r.totalTasks);
  if (taskIndex === null || totalTasks === null) return null;
  if (r.cursor !== null && (typeof r.cursor !== "string" || r.cursor.length > 4096)) return null;
  const counts = emptyCounts();
  const rc = (r.counts ?? {}) as Record<string, unknown>;
  for (const kind of HISTORY_KINDS) {
    const c = (rc[kind] ?? {}) as Record<string, unknown>;
    const found = wholeNumber(c.found);
    const isNew = wholeNumber(c.isNew);
    if (found === null || isNew === null) return null;
    counts[kind] = { found, isNew };
  }
  return {
    dryRun: r.dryRun,
    startedAt: new Date(r.startedAt).toISOString(),
    taskIndex,
    cursor: r.cursor as string | null,
    totalTasks,
    counts,
    done: r.done,
  };
}

// ---------------------------------------------------------------------------
// Square record -> CRM row
// ---------------------------------------------------------------------------

/**
 * What the CRM row already has. The import never clears a link the regular sync
 * made (customer matched by email/phone/name, invoice paid time from the payment).
 */
export type ExistingInvoice = { customer_id: string | null; paid_at: string | null };
export type ExistingPayment = { customer_id: string | null; square_invoice_id: string | null };
export type ExistingRefund = { customer_id: string | null };

/** No document_id here on purpose: the import never links or changes CRM documents. */
export function historyInvoiceRow(
  invoice: SquareInvoice,
  opts: {
    squareCustomer?: SquareCustomer;
    crmCustomerId: string | null;
    existing?: ExistingInvoice;
    now: string;
  }
): Record<string, unknown> | null {
  if (!invoice.id || !invoice.status) return null;
  const recipient = invoice.primary_recipient ?? {};
  const sq = opts.squareCustomer;
  const totals = invoiceTotals(invoice);
  return {
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
    square_customer_name: squareCustomerName(
      sq,
      [recipient.given_name, recipient.family_name].filter(Boolean).join(" ").trim() || null
    ),
    square_customer_email: recipient.email_address ?? sq?.email_address ?? null,
    square_customer_phone: recipient.phone_number ?? sq?.phone_number ?? null,
    customer_id: opts.existing?.customer_id ?? opts.crmCustomerId,
    square_created_at: invoice.created_at ?? null,
    paid_at: opts.existing?.paid_at ?? paidAtFromInvoice(invoice, totals.paid),
    synced_at: opts.now,
  };
}

export function historyPaymentRow(
  payment: SquarePayment,
  opts: {
    crmCustomerId: string | null;
    /** Square invoice for this payment's order, if the invoice is in the CRM. */
    invoiceId: string | null;
    existing?: ExistingPayment;
    now: string;
  }
): Record<string, unknown> | null {
  if (!payment.id || !payment.status) return null;
  return {
    square_payment_id: payment.id,
    square_customer_id: payment.customer_id ?? null,
    square_order_id: payment.order_id ?? null,
    square_invoice_id: opts.existing?.square_invoice_id ?? opts.invoiceId,
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
    customer_id: opts.existing?.customer_id ?? opts.crmCustomerId,
    square_created_at: payment.created_at ?? null,
    synced_at: opts.now,
  };
}

/** Refunds carry no customer: it comes from the refunded payment already in the CRM. */
export function historyRefundRow(
  refund: SquareRefund,
  opts: {
    payment?: { square_customer_id: string | null; customer_id: string | null };
    existing?: ExistingRefund;
    now: string;
  }
): Record<string, unknown> | null {
  if (!refund.id || !refund.status) return null;
  const fees = (refund.processing_fee ?? []).reduce((sum, f) => sum + (f.amount_money?.amount ?? 0), 0);
  return {
    square_refund_id: refund.id,
    square_payment_id: refund.payment_id ?? null,
    square_order_id: refund.order_id ?? null,
    square_location_id: refund.location_id ?? null,
    square_customer_id: opts.payment?.square_customer_id ?? null,
    status: refund.status,
    amount_cents: refund.amount_money?.amount ?? 0,
    processing_fee_cents: fees,
    currency: refund.amount_money?.currency ?? "USD",
    reason: refund.reason ?? null,
    destination_type: refund.destination_type ?? null,
    customer_id: opts.existing?.customer_id ?? opts.payment?.customer_id ?? null,
    square_created_at: refund.created_at ?? null,
    square_updated_at: refund.updated_at ?? null,
    synced_at: opts.now,
  };
}

/** Plain summary for the owner. */
export function describeHistoryProgress(p: HistoryProgress): string {
  const c = p.counts;
  const part = (n: HistoryCount, noun: string) => (p.dryRun ? `${n.found} ${noun} (${n.isNew} new)` : `${n.found} ${noun} (${n.isNew} added)`);
  return [part(c.invoices, "invoices"), part(c.payments, "payments"), part(c.refunds, "refunds")].join(", ");
}
