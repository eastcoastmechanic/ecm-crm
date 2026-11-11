// Pure money rules for invoicing the balance on a finished job. No database imports,
// so they can be tested on their own.

/** "$1,234.50" or "1234.5" to whole cents. Null when it is not a usable amount. */
export function parseMoneyToCents(raw: string): number | null {
  const cleaned = raw.trim().replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** What is still owed on a contract: total minus the deposit actually received. Never negative. */
export function balanceDueCents(totalCents: number, depositCents: number | null): number {
  return Math.max(0, totalCents - (depositCents ?? 0));
}

export function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}

export function formatMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** The document a job is linked to (jobs.document_id), as far as invoicing it needs. */
export type LinkedDoc = {
  doc_number: string | null;
  type: string | null;
  status?: string | null;
  total: number | string | null;
  deposit_received_cents: number | null;
};

export type BalanceLine = {
  description: string;
  notes: string | null;
  /** What is still owed (total less deposit received). Null when nothing linked gives a price. */
  cents: number | null;
};

/**
 * The balance line for a finished job, from the contract (or approved estimate) it is linked to.
 * Shared by the Create invoice button, its prefill on the Jobs list and the draft made on Finish,
 * so the math lives in one place. Only what the document says is used: no document, no total, or
 * an estimate the customer has not approved gives no price (cents null), never a guess.
 */
export function balanceLineFor(doc: LinkedDoc | null | undefined): BalanceLine {
  const plain: BalanceLine = { description: "Balance due for completed work", notes: null, cents: null };
  if (!doc) return plain;
  const isContract = doc.type === "contract";
  const isApprovedEstimate = doc.type === "estimate" && doc.status === "approved";
  if (!isContract && !isApprovedEstimate) return plain;

  const word = isContract ? "contract" : "estimate";
  const description = `Balance due on ${word} ${doc.doc_number ?? ""}`.trim();
  const total = doc.total == null ? NaN : Number(doc.total);
  if (!Number.isFinite(total)) return { description, notes: null, cents: null };

  const totalCents = Math.round(total * 100);
  const dep = doc.deposit_received_cents ?? null;
  const label = isContract ? "Contract" : "Estimate";
  return {
    description,
    notes: `${label} total ${formatMoney(totalCents)}${dep != null ? `, deposit received ${formatMoney(dep)}` : ""}`,
    cents: balanceDueCents(totalCents, dep),
  };
}

/** A live (not void) invoice on a job. */
export type JobInvoiceSummary = {
  id: string;
  doc_number: string | null;
  status: string | null;
  total: number | null;
  sent_at: string | null;
};

/** What Finish did about the job's invoice. Never sent to a tech. */
export type FinishInvoiceOutcome =
  | { kind: "created"; invoice: JobInvoiceSummary; priced: boolean }
  | { kind: "exists"; invoice: JobInvoiceSummary }
  | { kind: "none"; reason: string };

/** What the owner/office sees after pressing Finish. Built only for those roles, on the server. */
export type InvoicePrompt = {
  id: string;
  docNumber: string | null;
  totalCents: number;
  /** False when the draft has no priced lines yet: the office adds them before sending. */
  priced: boolean;
};

/** Not emailed yet and still a draft: the office should look at it and send it. */
export function invoiceNeedsSending(inv: Pick<JobInvoiceSummary, "status" | "sent_at">): boolean {
  return !inv.sent_at && (inv.status == null || inv.status === "draft");
}

/** One line for the owner's job-finished email. */
export function finishInvoiceAlertLine(outcome: FinishInvoiceOutcome): string {
  if (outcome.kind === "none") return `No invoice made: ${outcome.reason}`;
  const num = outcome.invoice.doc_number ?? "(no number)";
  if (outcome.kind === "created") {
    return outcome.priced
      ? `Draft invoice ${num} ready to review and send.`
      : `Draft invoice ${num} made with no price on file. Add line items, then send.`;
  }
  if (outcome.invoice.status === "paid") return `Invoice ${num} already paid.`;
  return invoiceNeedsSending(outcome.invoice)
    ? `Invoice ${num} already exists, not sent yet.`
    : `Invoice ${num} already sent.`;
}
