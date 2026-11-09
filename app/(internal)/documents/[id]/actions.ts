"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { getDocumentForPdf, dueDateForSend } from "@/lib/documents";
import { renderDocumentPdf } from "@/lib/pdf";
import { getAssessmentReportForPdf } from "@/lib/assessment-reports";
import { renderAssessmentReportPdf } from "@/lib/assessment-report-pdf";
import { getWarrantyReportForPdf } from "@/lib/warranty-reports";
import { renderWarrantyReportPdf } from "@/lib/warranty-report-pdf";
import { getContractForPdf } from "@/lib/contract-reports";
import { renderContractPdf } from "@/lib/contract-pdf";
import { sendPmReportToCustomer } from "@/lib/pm/send";
import { resend, RESEND_FROM_EMAIL, RESEND_REPLY_TO } from "@/lib/resend";
import { markDocumentPaid } from "@/lib/document-paid";
import { noteJobStep } from "@/lib/planner-connector";
import { requireOffice } from "@/lib/require-role";
import { documentTotal, officeTierUpdate, tierTotals } from "@/lib/estimate-tier";

type LineItem = {
  category: string;
  description: string;
  price_book_item_name: string | null;
  qty: number;
  unit: string;
  good: number | null;
  better: number | null;
  best: number | null;
  notes: string | null;
  cost?: number | null;
};

function parseNullableNumber(value: FormDataEntryValue | null): number | null {
  if (value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const CRAFTSMANSHIP_WARRANTY_YEARS = 1;

// Statuses a re-send leaves alone (the customer already paid, approved or signed).
const KEEP_STATUS_ON_RESEND = ["paid", "approved", "signed"];

async function notOffice(): Promise<boolean> {
  try {
    await requireOffice();
    return false;
  } catch {
    return true;
  }
}

function addYears(dateStr: string, years: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

type WarrantyActionItem = {
  equipment_id: string | null;
  equipment_label: string;
  model: string | null;
  serial_number: string | null;
  install_date: string | null;
  manufacturer: {
    docket_number: string | null;
    years: number | null;
    registered: boolean;
    registration_date: string | null;
    expiration_date: string | null;
  };
  craftsmanship: {
    years: number;
    expiration_date: string | null;
  };
};

export type FormState = { error?: string; saved?: boolean } | null;

/** Save the warranty editor. Returns { error } so the page shows the reason. */
export async function updateWarranty(_prev: FormState, formData: FormData): Promise<FormState> {
  if (await notOffice()) return { error: "Only the office or owner can do this." };
  const id = formData.get("id") as string;
  const technician_name = (formData.get("technician_name") as string)?.trim() || null;
  const itemCount = Number(formData.get("item_count") ?? 0);

  const { data: existing, error: fetchError } = await supabase
    .from("documents")
    .select("line_items")
    .eq("id", id)
    .single();
  if (fetchError || !existing) return { error: "Couldn't load this warranty. Refresh and try again." };

  const existingItems =
    (existing.line_items as { items?: WarrantyActionItem[] } | null)?.items ?? [];

  const items: WarrantyActionItem[] = [];
  for (let i = 0; i < itemCount; i++) {
    const existingItem = existingItems[i];
    const model = (formData.get(`model_${i}`) as string)?.trim() || null;
    const serial_number = (formData.get(`serial_number_${i}`) as string)?.trim() || null;
    const install_date = (formData.get(`install_date_${i}`) as string) || null;
    const docket_number = (formData.get(`docket_number_${i}`) as string)?.trim() || null;
    const manufacturer_years = formData.get(`manufacturer_years_${i}`)
      ? Number(formData.get(`manufacturer_years_${i}`))
      : null;
    const registered = formData.get(`registered_${i}`) === "on";
    const registration_date = (formData.get(`registration_date_${i}`) as string) || null;

    const manufacturer_expiration =
      install_date && manufacturer_years ? addYears(install_date, manufacturer_years) : null;
    const craftsmanship_years = existingItem?.craftsmanship.years ?? CRAFTSMANSHIP_WARRANTY_YEARS;
    const craftsmanship_expiration = install_date
      ? addYears(install_date, craftsmanship_years)
      : null;

    if (existingItem?.equipment_id) {
      const warranty_expiration =
        [manufacturer_expiration, craftsmanship_expiration]
          .filter((d): d is string => !!d)
          .sort()
          .pop() ?? null;

      await supabase
        .from("equipment")
        .update({
          ...(model ? { model } : {}),
          ...(serial_number ? { serial_number } : {}),
          ...(install_date ? { install_date } : {}),
          ...(warranty_expiration ? { warranty_expiration } : {}),
        })
        .eq("id", existingItem.equipment_id);
    }

    items.push({
      equipment_id: existingItem?.equipment_id ?? null,
      equipment_label: existingItem?.equipment_label ?? "Equipment",
      model,
      serial_number,
      install_date,
      manufacturer: {
        docket_number,
        years: manufacturer_years,
        registered,
        registration_date,
        expiration_date: manufacturer_expiration,
      },
      craftsmanship: {
        years: craftsmanship_years,
        expiration_date: craftsmanship_expiration,
      },
    });
  }

  const { error } = await supabase
    .from("documents")
    .update({ line_items: { technician_name, items } })
    .eq("id", id);

  if (error) return { error: "Couldn't save the warranty. Try again." };

  revalidatePath(`/documents/${id}`);
  revalidatePath("/documents");
  return { saved: true };
}

const PAID_SINCE_OPENED = "This document was paid since you opened it. Reload the page.";

export type UpdateDocumentState ={ error?: string; saved?: boolean } | null;

/** Save line items and status from the CRM. Returns { error } so the page shows the reason. */
export async function updateDocument(_prev: UpdateDocumentState, formData: FormData): Promise<UpdateDocumentState> {
  await requireOffice();
  const id = formData.get("id") as string;
  const status = formData.get("status") as string;
  const itemCount = Number(formData.get("item_count") ?? 0);
  const pricingMode = (formData.get("pricing_mode") as "tiered" | "flat") || "tiered";

  const { data: existing, error: fetchError } = await supabase
    .from("documents")
    .select("line_items, type, due_date, customer_id, job_id, status, selected_tier")
    .eq("id", id)
    .single();
  if (fetchError || !existing) return { error: "Couldn't load this document. Refresh and try again." };
  // A paid document stays paid. A form opened before the payment landed still
  // says Draft/Sent; saving it must not undo the payment.
  if (existing.status === "paid" && status !== "paid") return { error: PAID_SINCE_OPENED };

  const existingData = existing.line_items as {
    items: LineItem[];
    brand: unknown;
    mass_save_eligible: boolean;
    mass_save_note: string | null;
  };

  const items: LineItem[] = [];
  for (let i = 0; i < itemCount; i++) {
    // Cost is only ever rendered as an input for owner-role users
    // (LineItemsEditor.tsx) — when the field is absent from the submission
    // (any other role editing the same document), keep whatever cost was
    // already stored instead of reading it as a blank and wiping it out.
    const costKey = `cost_${i}`;
    items.push({
      category: (formData.get(`category_${i}`) as string) ?? "",
      description: (formData.get(`description_${i}`) as string) ?? "",
      price_book_item_name: (formData.get(`price_book_item_name_${i}`) as string) || null,
      qty: Number(formData.get(`qty_${i}`)) || 0,
      unit: (formData.get(`unit_${i}`) as string) ?? "EA",
      good: parseNullableNumber(formData.get(`good_${i}`)),
      better: parseNullableNumber(formData.get(`better_${i}`)),
      best: parseNullableNumber(formData.get(`best_${i}`)),
      notes: (formData.get(`notes_${i}`) as string) || null,
      cost: formData.has(costKey)
        ? parseNullableNumber(formData.get(costKey))
        : (existingData.items[i]?.cost ?? null),
    });
  }

  const totals = tierTotals(items);
  // The Good/Better/Best pick (customer's in the portal, or the office's for a
  // phone approval) sets the total; Better when there is none.
  const tierUpdate = officeTierUpdate({
    type: existing.type,
    pricingMode,
    newStatus: status,
    prevStatus: existing.status,
    prevTier: existing.selected_tier,
    picked: formData.get("selected_tier"),
    totals,
  });
  if (!tierUpdate.ok) return { error: tierUpdate.error };
  const docTotal = documentTotal(totals, tierUpdate.tier);

  const changesStatus = status !== "paid";
  const update = supabase
    .from("documents")
    .update({
      // "paid" goes through markDocumentPaid below (idempotent + post-paid steps).
      // (undefined = leave the column alone, so a concurrent webhook's "paid" is never overwritten by a stale read.)
      status: changesStatus ? status : undefined,
      line_items: {
        ...existingData,
        items,
        totals,
        pricing_mode: pricingMode,
      },
      ...(existing.type === "estimate" ? { selected_tier: tierUpdate.tier } : {}),
      subtotal: docTotal,
      tax: 0,
      total: docTotal,
      sent_at: status === "sent" ? new Date().toISOString() : undefined,
      due_date: status === "sent" ? dueDateForSend(existing.type, existing.due_date) : undefined,
    })
    .eq("id", id);

  // When the save sets a status, it only matches a row that is still not paid,
  // so a payment that lands between the read above and this write wins.
  const { data: saved, error } = await (changesStatus
    ? update.or("status.is.null,status.neq.paid")
    : update
  ).select("id");

  if (error) return { error: "Couldn't save the changes. Try again." };
  if (!saved || saved.length === 0) {
    return { error: changesStatus ? PAID_SINCE_OPENED : "Couldn't load this document. Refresh and try again." };
  }

  if (status === "paid") {
    const paid = await markDocumentPaid(id, { source: "manual" });
    if (paid.error) return { error: paid.error };
  }

  revalidatePath(`/documents/${id}`);
  revalidatePath("/documents");
  return { saved: true };
}

const typeLabel: Record<string, string> = {
  estimate: "Estimate",
  invoice: "Invoice",
  proposal: "Proposal",
};

function formatPrice(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export type SendDocumentState = { error?: string; sent?: boolean } | null;

type OutgoingEmail = {
  to: string;
  subject: string;
  text: string;
  filename: string;
  pdf: Buffer;
  extraUpdate?: Record<string, unknown>;
};

const NO_EMAIL = "This customer has no email on file. Use Edit to add one.";

/** Builds the email for one document, or says why it can't be sent. */
async function buildDocumentEmail(id: string, type: string | undefined): Promise<OutgoingEmail | { error: string }> {
  if (type === "assessment") {
    const { data, customerEmail, error } = await getAssessmentReportForPdf(id);
    if (error || !data) return { error: "Couldn't load this assessment. Refresh and try again." };
    if (!customerEmail) return { error: NO_EMAIL };
    return {
      to: customerEmail,
      subject: `Condition Assessment ${data.doc_number ?? ""} from East Coast Mechanical`,
      text: `Hi ${data.customer_name},\n\nAttached is the equipment condition assessment from your recent visit.\n\nLet us know if you have any questions.\n\nEast Coast Mechanical`,
      filename: `${data.doc_number ?? "assessment"}.pdf`,
      pdf: await renderAssessmentReportPdf(data),
    };
  }

  if (type === "warranty") {
    const { data, customerEmail, error } = await getWarrantyReportForPdf(id);
    if (error || !data) return { error: "Couldn't load this warranty. Refresh and try again." };
    if (!customerEmail) return { error: NO_EMAIL };
    return {
      to: customerEmail,
      subject: `Warranty Registration ${data.doc_number ?? ""} from East Coast Mechanical`,
      text: `Hi ${data.customer_name},\n\nAttached is your warranty registration, including our standard 1-year craftsmanship warranty on the install.\n\nLet us know if you have any questions.\n\nEast Coast Mechanical`,
      filename: `${data.doc_number ?? "warranty"}.pdf`,
      pdf: await renderWarrantyReportPdf(data),
    };
  }

  if (type === "contract") {
    const { data, customerEmail, error } = await getContractForPdf(id);
    if (error || !data) return { error: "Couldn't load this contract. Refresh and try again." };
    if (!customerEmail) return { error: NO_EMAIL };
    return {
      to: customerEmail,
      subject: `Contract ${data.doc_number ?? ""} from East Coast Mechanical — signature needed`,
      text: `Hi ${data.customer_name},\n\nAttached is your service contract ${data.doc_number ?? ""} (${formatPrice(data.total ?? 0)}). Please log in to your customer portal to review and sign it before work begins.\n\nLet us know if you have any questions.\n\nEast Coast Mechanical`,
      filename: `${data.doc_number ?? "contract"}.pdf`,
      pdf: await renderContractPdf(data),
    };
  }

  const { data, customerEmail, dueDate, error } = await getDocumentForPdf(id);
  if (error || !data) return { error: "Couldn't load this document. Refresh and try again." };
  if (!customerEmail) return { error: NO_EMAIL };
  // A draft made on Finish with no price on file has no lines: never email an empty invoice.
  if (data.type === "invoice" && Array.isArray(data.line_items) && data.line_items.length === 0) {
    return { error: "This invoice has no line items yet. Add them and save, then send." };
  }
  const label = typeLabel[data.type] ?? "Document";
  return {
    to: customerEmail,
    subject: `${label} ${data.doc_number ?? ""} from East Coast Mechanical`,
    text: `Hi ${data.customer_name},\n\nAttached is your ${label.toLowerCase()} ${data.doc_number ?? ""} (${
      data.chosen_option ? `${data.chosen_option} option total` : data.pricing_mode === "flat" ? "Total" : "Better tier total"
    }: ${formatPrice(data.totals.better)}).\n\nLet us know if you have any questions.\n\nEast Coast Mechanical`,
    filename: `${data.doc_number ?? label}.pdf`,
    pdf: await renderDocumentPdf(data),
    extraUpdate: { due_date: dueDateForSend(data.type, dueDate) },
  };
}

/**
 * Email a document to the customer as a PDF and mark it sent. Returns { error }
 * so the page shows the reason (a thrown message is hidden in production).
 */
export async function sendDocumentEmail(_prev: SendDocumentState, formData: FormData): Promise<SendDocumentState> {
  try {
    await requireOffice();
  } catch {
    return { error: "Only the office or owner can send documents." };
  }
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing document. Refresh and try again." };

  const { data: docType } = await supabase
    .from("documents")
    .select("type, status, job_id, doc_number")
    .eq("id", id)
    .maybeSingle();
  if (!docType) return { error: "Couldn't find this document. Refresh and try again." };

  if (docType.type === "pm_report") {
    let pm: { statusSaved: boolean };
    try {
      // Throws only when nothing went out, so "try again" can't send a duplicate.
      pm = await sendPmReportToCustomer(id);
    } catch (err) {
      console.error("sendDocumentEmail: PM report failed", err instanceof Error ? err.message : err);
      return { error: err instanceof Error && /no email on file/i.test(err.message) ? NO_EMAIL : "Couldn't send the report. Try again." };
    }
    revalidatePath(`/documents/${id}`);
    revalidatePath("/documents");
    if (!pm.statusSaved) return { error: "The email went out, but the status didn't save. Don't resend; refresh the page." };
    return { sent: true };
  }

  let email: OutgoingEmail | { error: string };
  try {
    email = await buildDocumentEmail(id, docType.type);
  } catch (err) {
    console.error("sendDocumentEmail: building the PDF failed", err instanceof Error ? err.message : err);
    return { error: "Couldn't build the PDF. Try again." };
  }
  if ("error" in email) return { error: email.error };

  try {
    const { error: sendError } = await resend.emails.send({
      from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
      replyTo: RESEND_REPLY_TO,
      to: email.to,
      subject: email.subject,
      text: email.text,
      attachments: [{ filename: email.filename, content: email.pdf }],
    });
    if (sendError) {
      console.error("sendDocumentEmail: send failed", sendError.message);
      return { error: "The email didn't go out. Check the customer's address and try again." };
    }
  } catch (err) {
    console.error("sendDocumentEmail: send threw", err instanceof Error ? err.message : err);
    return { error: "The email didn't go out. Try again." };
  }

  // Re-emailing a paid invoice, an approved estimate or a signed contract (a
  // copy for the customer's records) must not set it back to sent: the status
  // only changes on a row that hasn't reached one of those. sent_at is stamped
  // either way.
  const sentFields = { sent_at: new Date().toISOString(), ...(email.extraUpdate ?? {}) };
  const { data: marked, error: markError } = await supabase
    .from("documents")
    .update({ status: "sent", ...sentFields })
    .eq("id", id)
    .or(`status.is.null,status.not.in.(${KEEP_STATUS_ON_RESEND.join(",")})`)
    .select("id");
  let updateError = markError;
  if (!markError && (!marked || marked.length === 0)) {
    ({ error: updateError } = await supabase.from("documents").update(sentFields).eq("id", id));
  }
  // First send of a job's invoice: a dated "Invoice sent" line on the job's Planner card (no amount).
  // A resend, or an invoice already sent or paid, adds nothing.
  if (docType.type === "invoice" && docType.job_id && docType.status !== "sent" && marked && marked.length > 0) {
    await noteJobStep(docType.job_id as string, "invoice_sent", { docNumber: (docType.doc_number as string | null) ?? null });
  }
  revalidatePath(`/documents/${id}`);
  revalidatePath("/documents");
  if (updateError) {
    console.error("sendDocumentEmail: status update failed", updateError.message);
    return { error: "The email went out, but the status didn't save. Don't resend; refresh the page." };
  }
  return { sent: true };
}

/** Office-only: builds a Stripe checkout link for an unpaid invoice so it can be texted or emailed. */
export async function getInvoicePaymentLink(
  documentId: string
): Promise<{ ok: true; url: string; total: number } | { ok: false; error: string }> {
  await requireOffice();
  try {
    const { createInvoicePaymentLink } = await import("@/lib/payment-links");
    const { url, total } = await createInvoicePaymentLink(documentId);
    return { ok: true, url, total };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not create the payment link" };
  }
}

/** Office-only: a Stripe checkout link for a signed contract's deposit (amount from its terms), to text or email. */
export async function getDepositPaymentLink(
  documentId: string
): Promise<{ ok: true; url: string; total: number } | { ok: false; error: string }> {
  if (await notOffice()) return { ok: false, error: "Only the office or owner can do this." };
  try {
    const { createDepositPaymentLink } = await import("@/lib/payment-links");
    const { url, depositCents } = await createDepositPaymentLink(documentId);
    return { ok: true, url, total: depositCents / 100 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not create the deposit link" };
  }
}

const DEPOSIT_METHODS = ["card", "square", "check", "cash", "other"];

/** Office-only: record (or clear, with an empty amount) the deposit received on a contract. */
export async function recordContractDeposit(_prev: FormState, formData: FormData): Promise<FormState> {
  if (await notOffice()) return { error: "Only the office or owner can do this." };
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing contract. Refresh and try again." };

  const { data: doc } = await supabase.from("documents").select("id, type, total").eq("id", id).single();
  if (!doc || doc.type !== "contract") return { error: "Deposits can only be recorded on contracts." };

  const raw = String(formData.get("amount") ?? "").trim();
  if (!raw) {
    const { error: clearError } = await supabase
      .from("documents")
      .update({ deposit_received_cents: null, deposit_received_at: null, deposit_method: null })
      .eq("id", id);
    if (clearError) return { error: "Couldn't clear the deposit. Try again." };
  } else {
    const amount = Number(raw.replace(/[$,]/g, ""));
    if (!Number.isFinite(amount) || amount < 0) return { error: "Enter a valid deposit amount, like 1500 or 1,500.00." };
    if (doc.total != null && amount > Number(doc.total)) return { error: "The deposit can't be more than the contract total." };
    const method = String(formData.get("method") ?? "other");
    const date = String(formData.get("received_at") ?? "").trim();
    const { error } = await supabase
      .from("documents")
      .update({
        deposit_received_cents: Math.round(amount * 100),
        deposit_received_at: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
        deposit_method: DEPOSIT_METHODS.includes(method) ? method : "other",
      })
      .eq("id", id);
    if (error) return { error: "Couldn't save the deposit. Try again." };
  }
  revalidatePath(`/documents/${id}`);
  return { saved: true };
}
