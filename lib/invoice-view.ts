// What an invoice shows the customer: lines, totals, deposit note and balance due.
// Pure (no database, no clock unless passed in) so the PDF and the email show the
// same numbers and both can be tested. Nothing here changes money or status: the
// amount due is documents.total, the same number Stripe Checkout charges.

import type { LinkedDoc } from "@/lib/job-invoice-rules";

export type InvoiceLineInput = {
  description: string;
  category?: string | null;
  notes: string | null;
  qty: number;
  unit: string;
  /** Unit price. Invoices are one-price; an older tiered row uses its Better price, as before. */
  better: number | null;
};

export type InvoiceLine = {
  description: string;
  detail: string | null;
  qtyLabel: string;
  unitCents: number | null;
  amountCents: number | null;
};

export type InvoiceDepositNote = {
  word: "Contract" | "Estimate";
  docNumber: string | null;
  docTotalCents: number;
  depositCents: number;
  /** This invoice's total is exactly that document's total less the deposit, so we can say the deposit is taken off. */
  takenOff: boolean;
};

export type InvoiceView = {
  lines: InvoiceLine[];
  subtotalCents: number;
  taxCents: number;
  /** documents.total in cents: what the customer is billed and what Stripe charges. */
  totalCents: number;
  paid: boolean;
  /** What is left to pay: 0 once paid. */
  balanceDueCents: number;
  /** The deposit already received on the linked contract/approved estimate, for the customer's reference. */
  deposit: InvoiceDepositNote | null;
};

function toCents(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function qtyLabel(qty: number, unit: string): string {
  const q = Number.isFinite(qty) ? String(qty) : "";
  const u = (unit ?? "").trim();
  // "ea" next to a count reads as noise on a customer invoice.
  return u && u !== "ea" ? `${q} ${u}` : q;
}

export function buildInvoiceView(input: {
  lines: InvoiceLineInput[];
  total: number | string | null;
  tax?: number | string | null;
  status: string | null;
  linked?: LinkedDoc | null;
}): InvoiceView {
  const lines: InvoiceLine[] = input.lines.map((item) => {
    const unitCents = toCents(item.better);
    const qty = Number(item.qty);
    const amountCents = unitCents == null || !Number.isFinite(qty) ? null : Math.round(unitCents * qty);
    const detail = [item.category, item.notes].map((s) => (s ?? "").trim()).filter(Boolean).join(" · ");
    return {
      description: item.description,
      detail: detail || null,
      qtyLabel: qtyLabel(qty, item.unit),
      unitCents,
      amountCents,
    };
  });

  const subtotalCents = lines.reduce((sum, l) => sum + (l.amountCents ?? 0), 0);
  const taxCents = Math.max(0, toCents(input.tax) ?? 0);
  const totalCents = toCents(input.total) ?? subtotalCents + taxCents;
  const paid = input.status === "paid";

  return {
    lines,
    subtotalCents,
    taxCents,
    totalCents,
    paid,
    balanceDueCents: paid ? 0 : Math.max(0, totalCents),
    deposit: depositNote(input.linked ?? null, totalCents),
  };
}

/**
 * The deposit note: only from a contract or an approved estimate that recorded a
 * deposit, the same documents balanceLineFor bills from. Shown as a fact about
 * that document ("total $X, deposit received $Y"), never subtracted again here,
 * because the balance invoice's own lines already take it off.
 */
export function depositNote(doc: LinkedDoc | null, invoiceTotalCents: number): InvoiceDepositNote | null {
  if (!doc) return null;
  const isContract = doc.type === "contract";
  const isApprovedEstimate = doc.type === "estimate" && doc.status === "approved";
  if (!isContract && !isApprovedEstimate) return null;
  const dep = doc.deposit_received_cents ?? 0;
  const docTotalCents = toCents(doc.total);
  if (!(dep > 0) || docTotalCents == null) return null;
  return {
    word: isContract ? "Contract" : "Estimate",
    docNumber: doc.doc_number,
    docTotalCents,
    depositCents: dep,
    takenOff: invoiceTotalCents === docTotalCents - dep,
  };
}

/** Everything the invoice PDF and email need beyond the plain document. */
export type InvoiceExtras = {
  view: InvoiceView;
  /** ISO time or YYYY-MM-DD; printed as a New York date. */
  issueDate: string;
  /** YYYY-MM-DD, or null before the first send (net 30 is set then). */
  dueDate: string | null;
  /** Today's New York date (YYYY-MM-DD), for the past-due flag. */
  todayKey: string;
  /** documents.sent_at: set once the invoice has been emailed. */
  sentAt: string | null;
  createdAt: string;
  paidAt: string | null;
  jobRef: string | null;
  billTo: {
    name: string;
    company: string | null;
    address: string | null;
    email: string | null;
    phone: string | null;
  };
  /** Where the customer can pay any time (the portal). */
  portalUrl: string;
};

/**
 * The invoice as it goes out in an email: the issue date becomes the first send
 * (now, unless it was sent before) and the due date the one this send stores
 * (net 30 on a first send), so the attached PDF matches the saved row.
 */
export function invoiceForSend(extras: InvoiceExtras, newDueDate: string | undefined, now: Date): InvoiceExtras {
  return {
    ...extras,
    issueDate: invoiceIssueDate(extras.sentAt, extras.createdAt, now),
    dueDate: extras.dueDate ?? newDueDate ?? null,
  };
}

/** One sentence about the deposit, for the PDF and the email. */
export function depositSentence(d: InvoiceDepositNote): string {
  const doc = `${d.word}${d.docNumber ? ` ${d.docNumber}` : ""}`;
  const base = `${doc} total ${formatCents(d.docTotalCents)}. Deposit received ${formatCents(d.depositCents)}`;
  return d.takenOff ? `${base}, already taken off this invoice.` : `${base}.`;
}

/** Past the due date (New York calendar day) and still owing. */
export function isPastDue(view: Pick<InvoiceView, "paid" | "balanceDueCents">, dueDate: string | null, todayKey: string): boolean {
  if (view.paid || view.balanceDueCents <= 0 || !dueDate) return false;
  return dueDate < todayKey;
}

/**
 * The date printed as "Issued": the first send, or now when this is the first
 * send, else (a draft downloaded before sending) the day it was created.
 */
export function invoiceIssueDate(sentAt: string | null, createdAt: string, sendingAt?: Date): string {
  if (sentAt) return sentAt;
  if (sendingAt) return sendingAt.toISOString();
  return createdAt;
}

const JOB_TYPE_LABEL: Record<string, string> = {
  install: "Installation",
  service: "Service call",
  maintenance: "Maintenance visit",
};

/** "Service call, completed 11/9/2026" from the job; null when there is no job. formatDate is the New York formatter. */
export function jobReference(
  job: { job_type: string | null; completed_at: string | null; scheduled_at: string | null } | null,
  formatDate: (iso: string) => string
): string | null {
  if (!job) return null;
  const kind = (job.job_type && JOB_TYPE_LABEL[job.job_type]) || "Job";
  if (job.completed_at) return `${kind}, completed ${formatDate(job.completed_at)}`;
  if (job.scheduled_at) return `${kind}, scheduled ${formatDate(job.scheduled_at)}`;
  return kind;
}

export function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
