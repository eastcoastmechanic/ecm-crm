"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { requireOffice } from "@/lib/require-role";
import { createInvoiceDirect } from "@/lib/document-generation";
import { centsToDollars, formatMoney, parseMoneyToCents } from "@/lib/job-invoice-rules";

export type CreateInvoiceState = { error: string } | null;

/**
 * Office-only: make the invoice for a finished job. The amount is what the office types
 * (prefilled with contract total minus deposit received), so nothing is guessed here.
 * The invoice is linked to the job and opens as a draft, where Send and Pay now already live.
 */
export async function createBalanceInvoice(_prev: CreateInvoiceState, formData: FormData): Promise<CreateInvoiceState> {
  await requireOffice();
  const jobId = String(formData.get("job_id") ?? "");
  if (!jobId) return { error: "Missing job." };
  const cents = parseMoneyToCents(String(formData.get("amount") ?? ""));
  if (cents == null || cents <= 0) return { error: "Enter the amount to invoice." };

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id, status, customer_id, property_id, document_id")
    .eq("id", jobId)
    .maybeSingle();
  if (jobError) return { error: jobError.message };
  if (!job) return { error: "Job not found." };
  if (job.status !== "complete") return { error: "Finish the job before invoicing it." };
  if (!job.customer_id) return { error: "This job has no customer. Add one first." };

  const { data: existing, error: existingError } = await supabase
    .from("documents")
    .select("id")
    .eq("type", "invoice")
    .eq("job_id", jobId)
    .neq("status", "void")
    .limit(1);
  if (existingError) return { error: existingError.message };
  if (existing && existing.length > 0) return { error: "This job already has an invoice." };

  let description = "Balance due for completed work";
  let notes: string | null = null;
  if (job.document_id) {
    const { data: contract } = await supabase
      .from("documents")
      .select("doc_number, type, total, deposit_received_cents")
      .eq("id", job.document_id)
      .maybeSingle();
    if (contract && contract.type === "contract") {
      description = `Balance due on contract ${contract.doc_number ?? ""}`.trim();
      if (contract.total != null) {
        const dep = contract.deposit_received_cents;
        notes = `Contract total ${formatMoney(Math.round(Number(contract.total) * 100))}${
          dep != null ? `, deposit received ${formatMoney(dep)}` : ""
        }`;
      }
    }
  }

  const input = {
    customerId: job.customer_id as string,
    propertyId: (job.property_id as string | null) ?? null,
    jobId,
    items: [
      {
        category: "Contract balance",
        description,
        price_book_item_name: null,
        qty: 1,
        unit: "ea",
        unit_price: centsToDollars(cents),
        notes,
      },
    ],
  };

  // balance_for_job_id (SQL 0058) lets the database refuse a second live balance invoice for the job.
  // If that SQL has not been run yet, fall back to the check after the insert below.
  let documentId: string;
  try {
    let result;
    try {
      result = await createInvoiceDirect({ ...input, extra: { balance_for_job_id: jobId } });
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (/documents_one_balance_invoice_per_job_idx/.test(message)) return { error: "This job already has an invoice." };
      if (/balance_for_job_id/.test(message)) result = await createInvoiceDirect(input);
      else throw err;
    }
    documentId = result.documentId;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create the invoice." };
  }

  // Two taps (or two office users) can both pass the check above before either row exists.
  // Settle it after the insert: the earliest invoice for the job stays, any later one is voided,
  // so the customer is never left holding two payable invoices for the same job.
  const { data: mine } = await supabase
    .from("documents")
    .select("id, created_at")
    .eq("type", "invoice")
    .eq("job_id", jobId)
    .neq("status", "void")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (mine && mine.length > 1 && mine[0].id !== documentId) {
    await supabase.from("documents").update({ status: "void" }).eq("id", documentId);
    revalidatePath("/jobs");
    return { error: "This job already has an invoice." };
  }

  revalidatePath("/jobs");
  revalidatePath("/documents");
  redirect(`/documents/${documentId}`);
}
