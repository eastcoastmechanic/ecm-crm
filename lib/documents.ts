import { supabase } from "@/lib/supabase";
import type { PdfDocumentData } from "@/lib/pdf";

import type { LinkedDoc } from "@/lib/job-invoice-rules";
import { customerFacingJobPhotos, jobIdForDocument } from "@/lib/job-photos";
import { collapseToTier, selectedTier } from "@/lib/estimate-tier";
import { buildInvoiceView, invoiceIssueDate, jobReference, type InvoiceExtras } from "@/lib/invoice-view";
import { CUSTOMER_PORTAL_URL } from "@/lib/brand";
import { addDaysToDateKey, etDateKey, formatEtDate } from "@/lib/tz";

export async function getDocumentForPdf(id: string): Promise<{
  data: PdfDocumentData | null;
  customerEmail: string | null;
  dueDate: string | null;
  error: string | null;
}> {
  const { data: doc, error } = await supabase
    .from("documents")
    .select("*, customers(name, email, phone, company_name, billing_address), properties(address)")
    .eq("id", id)
    .single();

  if (error || !doc) {
    return {
      data: null,
      customerEmail: null,
      dueDate: null,
      error: error?.message ?? "Document not found",
    };
  }

  const rawLineData = doc.line_items as {
    items?: PdfDocumentData["line_items"];
    brand?: PdfDocumentData["brand"];
    mass_save_eligible?: boolean;
    mass_save_note?: string | null;
    totals?: PdfDocumentData["totals"];
    pricing_mode?: "tiered" | "flat";
  } | null;

  // Some older rows predate the totals/items shape — fall back rather than
  // crash PDF generation / email sending for those documents.
  const lineData = {
    items: rawLineData?.items ?? [],
    brand: rawLineData?.brand ?? { good: null, better: null, best: null },
    mass_save_eligible: rawLineData?.mass_save_eligible ?? false,
    mass_save_note: rawLineData?.mass_save_note ?? null,
    totals: rawLineData?.totals ?? { good: 0, better: 0, best: 0 },
    pricing_mode: rawLineData?.pricing_mode ?? "tiered",
  };

  // A picked Good/Better/Best option: the PDF shows only that option.
  const tier = selectedTier(lineData.pricing_mode, doc.selected_tier);
  const picked = tier
    ? collapseToTier({ line_items: lineData.items, totals: lineData.totals, brand: lineData.brand }, tier)
    : null;

  const lineItems = picked?.line_items ?? lineData.items;

  return {
    data: {
      doc_number: doc.doc_number,
      type: doc.type,
      created_at: doc.created_at,
      customer_name: doc.customers?.name ?? "Customer",
      property_address: doc.properties?.address ?? null,
      line_items: lineItems,
      brand: picked?.brand ?? lineData.brand,
      mass_save_eligible: lineData.mass_save_eligible,
      mass_save_note: lineData.mass_save_note,
      totals: picked?.totals ?? lineData.totals,
      pricing_mode: picked?.pricing_mode ?? lineData.pricing_mode,
      chosen_option: picked?.chosen_option,
      // If this document came out of a job, the arrival/completion photos go
      // on it. That's what makes an invoice defensible: the customer sees the
      // condition they paid to fix, next to the number.
      photos: await customerFacingJobPhotos(await jobIdForDocument(id)),
      invoice: doc.type === "invoice" ? await invoiceExtras(id, doc, lineItems) : undefined,
    },
    customerEmail: doc.customers?.email ?? null,
    dueDate: doc.due_date,
    error: null,
  };
}

type InvoiceRow = {
  created_at: string;
  sent_at?: string | null;
  paid_at?: string | null;
  due_date?: string | null;
  status: string | null;
  total: number | string | null;
  tax?: number | string | null;
  job_id?: string | null;
  balance_for_job_id?: string | null;
  customers?: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    company_name?: string | null;
    billing_address?: string | null;
  } | null;
};

/**
 * Invoice-only details for the PDF and email: bill-to, dates, the job it bills
 * and the deposit on that job's contract. Read-only; a failed lookup just
 * leaves that part off the invoice.
 */
async function invoiceExtras(id: string, doc: InvoiceRow, lineItems: PdfDocumentData["line_items"]): Promise<InvoiceExtras> {
  const jobId = doc.job_id ?? doc.balance_for_job_id ?? (await jobIdForDocument(id));
  let job: { job_type: string | null; completed_at: string | null; scheduled_at: string | null; document_id: string | null } | null = null;
  let linked: LinkedDoc | null = null;
  if (jobId) {
    const { data } = await supabase
      .from("jobs")
      .select("job_type, completed_at, scheduled_at, document_id")
      .eq("id", jobId)
      .maybeSingle();
    job = data ?? null;
    if (job?.document_id && job.document_id !== id) {
      const { data: linkedDoc } = await supabase
        .from("documents")
        .select("doc_number, type, status, total, deposit_received_cents")
        .eq("id", job.document_id)
        .maybeSingle();
      linked = (linkedDoc as LinkedDoc | null) ?? null;
    }
  }

  const c = doc.customers ?? {};
  return {
    view: buildInvoiceView({ lines: lineItems, total: doc.total, tax: doc.tax, status: doc.status, linked }),
    issueDate: invoiceIssueDate(doc.sent_at ?? null, doc.created_at),
    dueDate: doc.due_date ?? null,
    todayKey: etDateKey(),
    sentAt: doc.sent_at ?? null,
    createdAt: doc.created_at,
    paidAt: doc.paid_at ?? null,
    jobRef: jobReference(job, (iso) => formatEtDate(iso)),
    billTo: {
      name: c.name ?? "Customer",
      company: c.company_name || null,
      address: c.billing_address || null,
      email: c.email || null,
      phone: c.phone || null,
    },
    portalUrl: CUSTOMER_PORTAL_URL,
  };
}

/**
 * Invoices default to net-30 the first time they're marked sent: 30 days
 * after today's New York date (a late-evening send no longer lands a day late).
 */
export function dueDateForSend(type: string, existingDueDate: string | null, now: Date = new Date()): string | undefined {
  if (type !== "invoice" || existingDueDate) return undefined;
  return addDaysToDateKey(etDateKey(now), 30);
}
