"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { requireOffice } from "@/lib/require-role";
import { balanceLineFor, parseMoneyToCents } from "@/lib/job-invoice-rules";
import { createJobBalanceInvoice, findLiveJobInvoice, loadLinkedDoc } from "@/lib/finish-invoice";

export type CreateInvoiceState = { error: string } | null;

/**
 * Office-only: make the invoice for a finished job. The amount is what the office types
 * (prefilled with contract total minus deposit received), so nothing is guessed here.
 * The invoice is linked to the job and opens as a draft, where Send and Pay now already live.
 * Finish makes the same draft on its own (lib/finish-invoice.ts); this is the manual path for
 * a job that has none (an older job, or the draft was voided).
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

  try {
    if (await findLiveJobInvoice(jobId, job.document_id as string | null)) return { error: "This job already has an invoice." };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't check for an invoice. Try again." };
  }

  const line = balanceLineFor(await loadLinkedDoc(job.document_id as string | null));
  const result = await createJobBalanceInvoice(
    {
      id: jobId,
      customer_id: job.customer_id as string,
      property_id: (job.property_id as string | null) ?? null,
      document_id: (job.document_id as string | null) ?? null,
    },
    cents,
    line
  );
  if ("exists" in result) return { error: "This job already has an invoice." };
  if ("error" in result) return { error: result.error };

  revalidatePath("/jobs");
  revalidatePath("/documents");
  redirect(`/documents/${result.documentId}`);
}
