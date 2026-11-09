import { supabase } from "@/lib/supabase";
import { createInvoiceDirect } from "@/lib/document-generation";
import { getStaffRole } from "@/lib/require-role";
import {
  balanceLineFor,
  centsToDollars,
  invoiceNeedsSending,
  type BalanceLine,
  type FinishInvoiceOutcome,
  type InvoicePrompt,
  type JobInvoiceSummary,
  type LinkedDoc,
} from "@/lib/job-invoice-rules";

// The invoice side of finishing a job. "Office sends, tech never sees money": Finish makes sure
// the job has an invoice (a draft, never sent), and only owner/office ever get to see it.

// Ids go into a PostgREST or() filter, so only plain id characters (no commas, dots or brackets).
const ID = /^[\w-]+$/;

export type JobForInvoice = {
  id: string;
  customer_id: string | null;
  property_id: string | null;
  document_id: string | null;
};

/**
 * The job's live (not void) invoice, if it has one: the balance invoice, a service-report
 * invoice, or any invoice linked to the job (job_id, balance_for_job_id, or jobs.document_id).
 * One waiting to be sent comes first. Throws on a database error.
 */
export async function findLiveJobInvoice(jobId: string, documentId?: string | null): Promise<JobInvoiceSummary | null> {
  if (!ID.test(jobId)) return null;
  const ors = [`job_id.eq.${jobId}`, `balance_for_job_id.eq.${jobId}`];
  if (documentId && ID.test(documentId)) ors.push(`id.eq.${documentId}`);
  const { data, error } = await supabase
    .from("documents")
    .select("id, doc_number, status, total, sent_at")
    .eq("type", "invoice")
    .or(ors.join(","))
    .order("created_at", { ascending: true })
    .limit(20);
  if (error) throw new Error(error.message);
  const live = ((data ?? []) as JobInvoiceSummary[]).filter((d) => d.status !== "void");
  return live.find(invoiceNeedsSending) ?? live[0] ?? null;
}

/** The contract or estimate a job is linked to, with the fields the balance needs. */
export async function loadLinkedDoc(documentId: string | null): Promise<LinkedDoc | null> {
  if (!documentId) return null;
  const { data } = await supabase
    .from("documents")
    .select("doc_number, type, status, total, deposit_received_cents")
    .eq("id", documentId)
    .maybeSingle();
  return (data as LinkedDoc | null) ?? null;
}

export type CreateBalanceResult =
  | { documentId: string; docNumber: string; total: number }
  | { exists: true }
  | { error: string };

/**
 * Make the job's balance invoice as a draft. Used by the Create invoice button (the amount the
 * office typed) and by Finish (the linked balance, or null). With no amount the draft has no
 * line items at all, so nothing is priced until the office adds lines.
 *
 * balance_for_job_id (SQL 0058) has a unique index, so the database refuses a second live
 * balance invoice for the job even when two finishes race: that comes back as { exists: true }.
 */
export async function createJobBalanceInvoice(
  job: JobForInvoice & { customer_id: string },
  amountCents: number | null,
  line: BalanceLine
): Promise<CreateBalanceResult> {
  const items =
    amountCents != null && amountCents > 0
      ? [
          {
            category: "Contract balance",
            description: line.description,
            price_book_item_name: null,
            qty: 1,
            unit: "ea",
            unit_price: centsToDollars(amountCents),
            notes: line.notes,
          },
        ]
      : [];
  try {
    return await createInvoiceDirect({
      customerId: job.customer_id,
      propertyId: job.property_id ?? null,
      jobId: job.id,
      items,
      allowNoItems: items.length === 0,
      extra: { balance_for_job_id: job.id },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (/documents_one_balance_invoice_per_job_idx/.test(message)) return { exists: true };
    if (/balance_for_job_id/.test(message)) return { error: "Run SQL 0058 first (it stops a job being invoiced twice), then try again." };
    return { error: message || "Could not create the invoice." };
  }
}

/**
 * Called once when a job becomes complete (applyJobStatus, changed = true): wherever the
 * Finish came from (truck, phone queue, Jobs list, assistant, field bot). If the job already has
 * a live invoice nothing new is made. Otherwise a draft balance invoice is made through the same
 * path as Create invoice. Never sends anything and never throws: a finished job stays finished.
 */
export async function ensureFinishInvoice(jobId: string): Promise<FinishInvoiceOutcome> {
  try {
    const { data: job, error } = await supabase
      .from("jobs")
      .select("id, customer_id, property_id, document_id")
      .eq("id", jobId)
      .maybeSingle();
    if (error) return { kind: "none", reason: "couldn't read the job." };
    if (!job) return { kind: "none", reason: "job not found." };
    const row = job as JobForInvoice;

    const existing = await findLiveJobInvoice(row.id, row.document_id);
    if (existing) return { kind: "exists", invoice: existing };
    if (!row.customer_id) return { kind: "none", reason: "the job has no customer. Add one, then use Create invoice." };

    const line = balanceLineFor(await loadLinkedDoc(row.document_id));
    // The deposit already covers the whole price: nothing left to bill, so no empty draft.
    if (line.cents === 0) {
      return { kind: "none", reason: "the deposit received covers the full total, so there is no balance to bill." };
    }
    const result = await createJobBalanceInvoice({ ...row, customer_id: row.customer_id }, line.cents, line);
    if ("exists" in result) {
      const raced = await findLiveJobInvoice(row.id, row.document_id);
      return raced ? { kind: "exists", invoice: raced } : { kind: "none", reason: "another invoice was being made at the same time." };
    }
    if ("error" in result) return { kind: "none", reason: result.error };

    // TODO(planner): once the Planner/lead-intake PR lands, call noteJobStep(jobId, "invoice_created") here.
    return {
      kind: "created",
      priced: result.total > 0,
      invoice: { id: result.documentId, doc_number: result.docNumber, status: "draft", total: result.total, sent_at: null },
    };
  } catch (err) {
    console.error(`[finish-invoice] job ${jobId}:`, err instanceof Error ? err.message : err);
    return { kind: "none", reason: "something went wrong checking the invoice. Use Create invoice on the Jobs list." };
  }
}

/**
 * Before a service-report invoice (parts and labor) is made for a job. Finish may already have
 * made an empty draft (no price on file): that one is voided, since it holds nothing and the
 * report invoice replaces it. Any other live invoice means the job is invoiced already, so the
 * report invoice is refused rather than billing the customer twice.
 */
export async function makeRoomForReportInvoice(jobId: string | null | undefined): Promise<{ error?: string }> {
  if (!jobId) return {};
  let inv: JobInvoiceSummary | null;
  try {
    const { data: job } = await supabase.from("jobs").select("document_id").eq("id", jobId).maybeSingle();
    inv = await findLiveJobInvoice(jobId, (job?.document_id as string | null | undefined) ?? null);
  } catch {
    return { error: "Couldn't check the job's invoices. Try again." };
  }
  if (!inv) return {};

  // Only our own empty, unsent Finish draft: the conditions are in the update itself.
  if (invoiceNeedsSending(inv) && Number(inv.total ?? 0) === 0) {
    const { data: voided, error } = await supabase
      .from("documents")
      .update({ status: "void" })
      .eq("id", inv.id)
      .eq("balance_for_job_id", jobId)
      .eq("status", "draft")
      .is("sent_at", null)
      .eq("total", 0)
      .select("id");
    if (!error && voided && voided.length > 0) return {};
  }
  const which = inv.doc_number ? `invoice ${inv.doc_number}` : "an invoice";
  return { error: `This job already has ${which}. Open it from Documents and add the parts and labor there.` };
}

/**
 * The "Send now / Open" prompt for a finished job, for owner and office only. Checks the role
 * itself, so a tech's request gets null even if a caller forgets. Null when the job's invoice is
 * already sent or paid, or there is none.
 */
export async function getInvoicePrompt(jobId: string): Promise<InvoicePrompt | null> {
  const role = await getStaffRole();
  if (role !== "owner" && role !== "office") return null;
  try {
    const { data: job } = await supabase.from("jobs").select("document_id").eq("id", jobId).maybeSingle();
    const inv = await findLiveJobInvoice(jobId, (job?.document_id as string | null | undefined) ?? null);
    if (!inv || !invoiceNeedsSending(inv)) return null;
    const totalCents = Math.round(Number(inv.total ?? 0) * 100);
    return { id: inv.id, docNumber: inv.doc_number, totalCents, priced: totalCents > 0 };
  } catch (err) {
    console.error(`[finish-invoice] prompt for job ${jobId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}
