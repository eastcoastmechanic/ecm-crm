"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { getServiceReportForPdf } from "@/lib/service-reports";
import { renderServiceReportPdf } from "@/lib/service-report-pdf";
import { resend, RESEND_FROM_EMAIL, RESEND_REPLY_TO } from "@/lib/resend";
import { resolveCustomerPropertyEquipment } from "@/lib/customer-intake";
import { createInvoiceDirect, type DirectLineItem } from "@/lib/document-generation";
import { makeRoomForReportInvoice } from "@/lib/finish-invoice";
import { requireOffice } from "@/lib/require-role";
import { checkJobAccess } from "@/lib/job-access";
import { parsePartsUsed } from "@/lib/parts-used";
import { etLocalFromIso, parseEtLocal } from "@/lib/tz";

export type ReportState = { error?: string; saved?: boolean } | null;

async function notOffice(): Promise<boolean> {
  try {
    await requireOffice();
    return false;
  } catch {
    return true;
  }
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Attach a service report to a customer. Office and owner only: it can create a
 * customer and set their text consent. Returns { error } so the form shows the reason.
 */
export async function assignCustomer(_prev: ReportState, formData: FormData): Promise<ReportState> {
  if (await notOffice()) return { error: "Only the office or owner can assign a customer." };
  const diagnosticId = formData.get("diagnostic_id") as string;
  const customerId = (formData.get("customer_id") as string) || null;
  const customerName = (formData.get("customer_name") as string)?.trim() || null;
  const phone = (formData.get("phone") as string)?.trim() || null;
  const smsConsent = formData.get("sms_consent") === "on";
  const propertyId = (formData.get("property_id") as string) || null;
  const address = (formData.get("address") as string)?.trim() || null;
  const equipmentId = (formData.get("equipment_id") as string) || null;
  const equipmentType = (formData.get("equipment_type") as string)?.trim() || null;
  const equipmentBrand = (formData.get("equipment_brand") as string)?.trim() || null;
  const equipmentModel = (formData.get("equipment_model") as string)?.trim() || null;
  const equipmentRefrigerant = (formData.get("equipment_refrigerant") as string) || null;

  if (!diagnosticId) return { error: "Missing service report. Refresh and try again." };
  if (!customerId && !customerName) return { error: "Pick a customer, or type the new customer's name." };

  let resolved: Awaited<ReturnType<typeof resolveCustomerPropertyEquipment>>;
  try {
    resolved = await resolveCustomerPropertyEquipment({
      customerId,
      customerName,
      phone,
      smsConsent,
      propertyId,
      address,
      equipmentId,
      equipment: equipmentType
        ? { type: equipmentType, brand: equipmentBrand, model: equipmentModel, refrigerant_type: equipmentRefrigerant }
        : null,
    });
  } catch (err) {
    console.error("assignCustomer: resolve failed", errText(err));
    return { error: "Couldn't save the customer, property or equipment. Try again." };
  }

  if (resolved.equipmentId) {
    const { error } = await supabase
      .from("diagnostics")
      .update({ equipment_id: resolved.equipmentId })
      .eq("id", diagnosticId);
    if (error) return { error: "Saved the customer, but couldn't link the equipment to this report. Try again." };
  }

  const { data: diagnostic } = await supabase
    .from("diagnostics")
    .select("job_id")
    .eq("id", diagnosticId)
    .single();

  if (diagnostic?.job_id) {
    const { data: job } = await supabase
      .from("jobs")
      .select("customer_id, property_id")
      .eq("id", diagnostic.job_id)
      .single();

    const updates: Record<string, string> = {};
    if (job && !job.customer_id && resolved.customerId) updates.customer_id = resolved.customerId;
    if (job && !job.property_id && resolved.propertyId) updates.property_id = resolved.propertyId;
    if (Object.keys(updates).length) {
      await supabase.from("jobs").update(updates).eq("id", diagnostic.job_id);
    }
  }

  revalidatePath(`/diagnostics/${diagnosticId}`);
  revalidatePath("/diagnostics");
  revalidatePath("/jobs");
  revalidatePath("/customers");
  revalidatePath("/properties");
  revalidatePath("/equipment");
  return { saved: true };
}

/**
 * Save the parts used on a report and move truck inventory by the difference.
 * A tech may do this only on a report for a job that is theirs (or not yet
 * assigned); a report with no job is office and owner only.
 */
export async function recordPartsUsed(_prev: ReportState, formData: FormData): Promise<ReportState> {
  const diagnosticId = String(formData.get("diagnostic_id") ?? "");
  if (!diagnosticId) return { error: "Missing service report. Refresh and try again." };

  // What this report already took out of inventory, so saving again only moves
  // the difference instead of deducting the whole list a second time.
  const { data: before, error: beforeError } = await supabase
    .from("diagnostics")
    .select("job_id, actual_parts_used")
    .eq("id", diagnosticId)
    .maybeSingle();
  // Without the saved list we cannot tell what was already deducted, so stop
  // rather than take the whole list out of inventory again.
  if (beforeError) return { error: "Couldn't load the saved parts, so nothing was changed. Try again." };
  if (!before) return { error: "Couldn't find this service report. Refresh and try again." };

  const access = await checkJobAccess(before.job_id as string | null, { allowClosedJob: true });
  if (access.error !== undefined) return { error: access.error };

  const parsed = parsePartsUsed(formData);
  if (parsed.error !== undefined) return { error: parsed.error };
  const parts = parsed.parts;

  // Prices come from the price book on the server. A tech's submitted prices are
  // ignored entirely (they never see prices, and must not be able to set them);
  // for office, a price already on the form is kept. Where a part has several tier
  // rows, the "better" tier wins, matching what the office form shows.
  const isTech = access.role === "tech";
  for (const part of parts) {
    if (isTech) part.unit_price = null;
    if (part.unit_price !== null) continue;
    const { data: rows } = await supabase
      .from("price_book_items")
      .select("tier, unit_price")
      .eq("name", part.price_book_item_name)
      .not("unit_price", "is", null);
    const priced = (rows ?? []).find((r) => r.tier === "better") ?? (rows ?? [])[0];
    if (priced?.unit_price != null) part.unit_price = Number(priced.unit_price);
  }

  const previousQty = new Map<string, number>();
  for (const p of (before.actual_parts_used ?? []) as { price_book_item_name?: string; qty?: number }[]) {
    if (!p?.price_book_item_name) continue;
    previousQty.set(p.price_book_item_name, (previousQty.get(p.price_book_item_name) ?? 0) + Number(p.qty || 0));
  }
  const newQty = new Map<string, number>();
  for (const p of parts) newQty.set(p.price_book_item_name, (newQty.get(p.price_book_item_name) ?? 0) + p.qty);

  const { error } = await supabase
    .from("diagnostics")
    .update({ actual_parts_used: parts })
    .eq("id", diagnosticId);
  if (error) return { error: "Couldn't save the parts. Try again." };

  // Best-effort inventory deduction -- matched by price book item name since
  // tiers (good/better/best) are separate rows for the same physical part,
  // and inventory only tracks one row per part regardless of which tier id
  // it was originally added under.
  // Positive delta takes stock out; a part removed or reduced puts it back.
  for (const name of new Set([...previousQty.keys(), ...newQty.keys()])) {
    const delta = (newQty.get(name) ?? 0) - (previousQty.get(name) ?? 0);
    if (delta === 0) continue;

    const { data: matchingItems } = await supabase
      .from("price_book_items")
      .select("id")
      .eq("name", name);
    const ids = (matchingItems ?? []).map((r) => r.id);
    if (ids.length === 0) continue;

    const { data: invRow } = await supabase
      .from("inventory_items")
      .select("id, qty_on_hand")
      .in("price_book_item_id", ids)
      .limit(1)
      .maybeSingle();

    if (invRow) {
      await supabase
        .from("inventory_items")
        .update({ qty_on_hand: Math.max(0, invRow.qty_on_hand - delta), updated_at: new Date().toISOString() })
        .eq("id", invRow.id);
    }
  }

  revalidatePath(`/diagnostics/${diagnosticId}`);
  revalidatePath("/inventory");
  return { saved: true };
}

/**
 * The form's datetime-local value is New York wall time. The server runs in UTC,
 * so new Date(value) used to store it 4 to 5 hours off. A value with a zone
 * (from the assistant) is taken as given.
 */
function parseLocalDateTime(value: FormDataEntryValue | null): string | null {
  if (!value || typeof value !== "string") return null;
  const local = etLocalFromIso(value);
  const when = local ? parseEtLocal(local) : null;
  return when ? when.toISOString() : null;
}

type ReportForInvoice = {
  actual_parts_used?: unknown;
  job_id?: string | null;
};

/** Builds the invoice for a service report from its saved parts and tracked time. */
async function createReportInvoice(
  diagnostic: ReportForInvoice,
  customerId: string,
  propertyId: string | null,
  trackedHours: number | null
): Promise<{ documentId: string; error?: undefined } | { error: string; documentId?: undefined }> {
  const actualPartsUsed = (diagnostic.actual_parts_used ?? []) as {
    price_book_item_name: string;
    qty: number;
    unit_price: number | null;
  }[];

  const items: DirectLineItem[] = actualPartsUsed
    .filter((p) => p.unit_price !== null)
    .map((p) => ({
      category: "Parts",
      description: p.price_book_item_name,
      price_book_item_name: p.price_book_item_name,
      qty: p.qty,
      unit: "EA",
      unit_price: p.unit_price as number,
      notes: null,
    }));

  const hourlyRate = Number(process.env.HOURLY_LABOR_RATE) || null;
  if (trackedHours && hourlyRate) {
    items.push({
      category: "Labor",
      description: "Labor",
      price_book_item_name: null,
      qty: trackedHours,
      unit: "HR",
      unit_price: hourlyRate,
      notes: "Auto-added from service report time tracking",
    });
  }

  if (items.length === 0) {
    return {
      error:
        "Nothing to invoice yet: save the parts used and/or enter the start and end time (labor needs HOURLY_LABOR_RATE set) first.",
    };
  }

  // One live invoice per job: Finish may have made an empty draft already (voided here), or the
  // job may be invoiced already (refused, so the customer is not billed twice).
  const room = await makeRoomForReportInvoice(diagnostic.job_id);
  if (room.error) return { error: room.error };

  try {
    const result = await createInvoiceDirect({ customerId, propertyId, items, jobId: diagnostic.job_id ?? undefined });
    return { documentId: result.documentId };
  } catch (err) {
    console.error("createReportInvoice failed", errText(err));
    return { error: "Couldn't create the invoice. Try again." };
  }
}

/** Office-only: invoice a report a tech already finished without one (techs can't create invoices). */
export async function createInvoiceForFinishedReport(_prev: ReportState, formData: FormData): Promise<ReportState> {
  if (await notOffice()) return { error: "Only the office or owner can create invoices." };
  const diagnosticId = String(formData.get("diagnostic_id") ?? "");

  const { data: diagnostic, error } = await supabase
    .from("diagnostics")
    .select("*, equipment(properties(id, customer_id)), jobs(customer_id, property_id, document_id)")
    .eq("id", diagnosticId)
    .maybeSingle();
  if (error || !diagnostic) return { error: "Couldn't load this service report. Refresh and try again." };
  if (!diagnostic.completed_at) return { error: "Finish the service report first." };
  if (diagnostic.invoice_document_id) return { error: "This report already has an invoice. Refresh the page." };

  const customerId = diagnostic.equipment?.properties?.customer_id ?? diagnostic.jobs?.customer_id ?? null;
  const propertyId = diagnostic.equipment?.properties?.id ?? diagnostic.jobs?.property_id ?? null;
  if (!customerId) return { error: "Assign a customer before creating an invoice." };

  const result = await createReportInvoice(diagnostic, customerId, propertyId, diagnostic.tracked_hours ?? null);
  if (result.error !== undefined) return { error: result.error };

  if (diagnostic.job_id && !diagnostic.jobs?.document_id) {
    await supabase.from("jobs").update({ document_id: result.documentId }).eq("id", diagnostic.job_id);
  }
  const { error: updateError } = await supabase
    .from("diagnostics")
    .update({ invoice_document_id: result.documentId })
    .eq("id", diagnosticId);
  revalidatePath(`/diagnostics/${diagnosticId}`);
  revalidatePath("/documents");
  revalidatePath("/jobs");
  if (updateError) {
    console.error("createInvoiceForFinishedReport: link failed", updateError.message);
    return { error: "The invoice was created (see Documents) but couldn't be linked to this report. Don't create another." };
  }
  return { saved: true };
}

/**
 * Finish a service call: save the times, optionally raise the invoice, mark it
 * complete. The invoice is made first, so if it can't be made the report is
 * not marked finished and the typed times stay on the form.
 */
export async function finishServiceReport(_prev: ReportState, formData: FormData): Promise<ReportState> {
  const diagnosticId = String(formData.get("diagnostic_id") ?? "");
  const timeStartedAt = parseLocalDateTime(formData.get("time_started_at"));
  const timeEndedAt = parseLocalDateTime(formData.get("time_ended_at"));
  if (timeStartedAt && timeEndedAt && timeEndedAt < timeStartedAt) {
    return { error: "The end time is before the start time." };
  }

  const trackedHours =
    timeStartedAt && timeEndedAt
      ? Math.max(0, Math.round(((new Date(timeEndedAt).getTime() - new Date(timeStartedAt).getTime()) / 3600000) * 100) / 100)
      : null;

  const { data: diagnostic, error: fetchError } = await supabase
    .from("diagnostics")
    .select("*, equipment(properties(id, customer_id)), jobs(customer_id, property_id, document_id)")
    .eq("id", diagnosticId)
    .maybeSingle();
  if (fetchError || !diagnostic) return { error: "Couldn't load this service report. Refresh and try again." };

  // A tech finishes only a report for a job that is theirs (or not yet assigned).
  // A report with no job is office and owner only.
  const access = await checkJobAccess(diagnostic.job_id as string | null, { allowClosedJob: true });
  if (access.error !== undefined) return { error: access.error };
  // The page hides Finish once a report is finished. Refuse a second finish so the
  // saved times and hours can't be overwritten after the office invoiced it.
  if (diagnostic.completed_at) return { error: "This report is already finished. Refresh the page." };

  const customerId = diagnostic.equipment?.properties?.customer_id ?? diagnostic.jobs?.customer_id ?? null;
  const propertyId = diagnostic.equipment?.properties?.id ?? diagnostic.jobs?.property_id ?? null;

  const createInvoice = formData.get("create_invoice") === "on";
  let invoiceDocumentId: string | null = diagnostic.invoice_document_id ?? null;

  if (createInvoice && !invoiceDocumentId) {
    if (access.role === "tech") return { error: "Only the office or owner can create invoices. Untick the invoice box." };
    if (!customerId) return { error: "Assign a customer before creating an invoice, or untick the invoice box." };

    const result = await createReportInvoice(diagnostic, customerId, propertyId, trackedHours);
    if (result.error !== undefined) return { error: `${result.error} Or untick the invoice box to finish without one.` };
    invoiceDocumentId = result.documentId;

    if (diagnostic.job_id && !diagnostic.jobs?.document_id) {
      await supabase.from("jobs").update({ document_id: invoiceDocumentId }).eq("id", diagnostic.job_id);
    }
  }

  const { error } = await supabase
    .from("diagnostics")
    .update({
      time_started_at: timeStartedAt,
      time_ended_at: timeEndedAt,
      tracked_hours: trackedHours,
      completed_at: new Date().toISOString(),
      invoice_document_id: invoiceDocumentId,
    })
    .eq("id", diagnosticId);
  revalidatePath(`/diagnostics/${diagnosticId}`);
  revalidatePath("/diagnostics");
  revalidatePath("/documents");
  revalidatePath("/jobs");
  if (error) {
    console.error("finishServiceReport: update failed", error.message);
    return {
      error:
        invoiceDocumentId && invoiceDocumentId !== diagnostic.invoice_document_id
          ? "The invoice was created (see Documents) but the report didn't save as finished. Untick the invoice box and press Finish again."
          : "Couldn't finish the report. Try again.",
    };
  }
  return { saved: true };
}

/** Email the finished service report as a PDF. Returns { error } so the page shows the reason. */
export async function sendServiceReportEmail(_prev: ReportState, formData: FormData): Promise<ReportState> {
  if (await notOffice()) return { error: "Only the office or owner can send reports." };
  const id = String(formData.get("id") ?? "");

  let pdfBuffer: Buffer;
  let to: string;
  let subject: string;
  let text: string;
  let filename: string;
  try {
    const { data, customerEmail, error } = await getServiceReportForPdf(id);
    if (error || !data) return { error: "Couldn't load this service report. Refresh and try again." };
    if (!customerEmail) return { error: "This customer has no email on file. Add one on the customer page." };
    pdfBuffer = await renderServiceReportPdf(data);
    to = customerEmail;
    subject = `Service Report ${data.doc_number ?? ""} from East Coast Mechanical`;
    text = `Hi ${data.customer_name},\n\nAttached is the service report from your recent visit${
      data.equipment_label ? ` for your ${data.equipment_label}` : ""
    }.\n\nLet us know if you have any questions.\n\nEast Coast Mechanical`;
    filename = `${data.doc_number ?? "service-report"}.pdf`;
  } catch (err) {
    console.error("sendServiceReportEmail: PDF failed", errText(err));
    return { error: "Couldn't build the PDF. Try again." };
  }

  try {
    const { error: sendError } = await resend.emails.send({
      from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
      replyTo: RESEND_REPLY_TO,
      to,
      subject,
      text,
      attachments: [{ filename, content: pdfBuffer }],
    });
    if (sendError) {
      console.error("sendServiceReportEmail: send failed", sendError.message);
      return { error: "The email didn't go out. Check the customer's address and try again." };
    }
  } catch (err) {
    console.error("sendServiceReportEmail: send threw", errText(err));
    return { error: "The email didn't go out. Try again." };
  }

  const { error: updateError } = await supabase
    .from("diagnostics")
    .update({ report_sent_at: new Date().toISOString() })
    .eq("id", id);
  revalidatePath(`/diagnostics/${id}`);
  if (updateError) {
    console.error("sendServiceReportEmail: status update failed", updateError.message);
    return { error: "The email went out, but the sent date didn't save. Don't resend; refresh the page." };
  }
  return { saved: true };
}
