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
import { resend, RESEND_FROM_EMAIL } from "@/lib/resend";
import { flagReferralRewardIfEligible } from "@/lib/referral";
import { movePlannerTaskForJob } from "@/lib/planner-connector";

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

function sumTier(items: LineItem[], tier: "good" | "better" | "best") {
  const total = items.reduce((sum, item) => {
    const price = item[tier];
    return price === null ? sum : sum + price * item.qty;
  }, 0);
  return Math.round(total * 100) / 100;
}

const CRAFTSMANSHIP_WARRANTY_YEARS = 1;

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

export async function updateWarranty(formData: FormData) {
  const id = formData.get("id") as string;
  const technician_name = (formData.get("technician_name") as string)?.trim() || null;
  const itemCount = Number(formData.get("item_count") ?? 0);

  const { data: existing, error: fetchError } = await supabase
    .from("documents")
    .select("line_items")
    .eq("id", id)
    .single();
  if (fetchError) throw new Error(fetchError.message);

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

  if (error) throw new Error(error.message);

  revalidatePath(`/documents/${id}`);
  revalidatePath("/documents");
}

export async function updateDocument(formData: FormData) {
  const id = formData.get("id") as string;
  const status = formData.get("status") as string;
  const itemCount = Number(formData.get("item_count") ?? 0);
  const pricingMode = (formData.get("pricing_mode") as "tiered" | "flat") || "tiered";

  const { data: existing, error: fetchError } = await supabase
    .from("documents")
    .select("line_items, type, due_date, customer_id, job_id")
    .eq("id", id)
    .single();
  if (fetchError) throw new Error(fetchError.message);

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

  const totals = {
    good: sumTier(items, "good"),
    better: sumTier(items, "better"),
    best: sumTier(items, "best"),
  };

  const { error } = await supabase
    .from("documents")
    .update({
      status,
      line_items: {
        ...existingData,
        items,
        totals,
        pricing_mode: pricingMode,
      },
      subtotal: totals.better,
      tax: 0,
      total: totals.better,
      sent_at: status === "sent" ? new Date().toISOString() : undefined,
      paid_at: status === "paid" ? new Date().toISOString() : undefined,
      due_date: status === "sent" ? dueDateForSend(existing.type, existing.due_date) : undefined,
    })
    .eq("id", id);

  if (error) throw new Error(error.message);

  if (status === "paid" && existing.customer_id) {
    await flagReferralRewardIfEligible(existing.customer_id, existing.type);
  }

  if (status === "paid" && existing.type === "invoice" && existing.job_id) {
    await movePlannerTaskForJob(existing.job_id, "billed");
  }

  revalidatePath(`/documents/${id}`);
  revalidatePath("/documents");
}

const typeLabel: Record<string, string> = {
  estimate: "Estimate",
  invoice: "Invoice",
  proposal: "Proposal",
};

function formatPrice(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export async function sendDocumentEmail(formData: FormData) {
  const id = formData.get("id") as string;

  const { data: docType } = await supabase.from("documents").select("type").eq("id", id).single();

  if (docType?.type === "assessment") {
    const { data, customerEmail, error } = await getAssessmentReportForPdf(id);
    if (error || !data) throw new Error(error ?? "Assessment not found");
    if (!customerEmail) throw new Error("Customer has no email on file");

    const pdfBuffer = await renderAssessmentReportPdf(data);

    const { error: sendError } = await resend.emails.send({
      from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
      to: customerEmail,
      subject: `Condition Assessment ${data.doc_number ?? ""} from East Coast Mechanical`,
      text: `Hi ${data.customer_name},\n\nAttached is the equipment condition assessment from your recent visit.\n\nLet us know if you have any questions.\n\nEast Coast Mechanical`,
      attachments: [{ filename: `${data.doc_number ?? "assessment"}.pdf`, content: pdfBuffer }],
    });
    if (sendError) throw new Error(sendError.message);

    const { error: updateError } = await supabase
      .from("documents")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", id);
    if (updateError) throw new Error(updateError.message);

    revalidatePath(`/documents/${id}`);
    revalidatePath("/documents");
    return;
  }

  if (docType?.type === "warranty") {
    const { data, customerEmail, error } = await getWarrantyReportForPdf(id);
    if (error || !data) throw new Error(error ?? "Warranty not found");
    if (!customerEmail) throw new Error("Customer has no email on file");

    const pdfBuffer = await renderWarrantyReportPdf(data);

    const { error: sendError } = await resend.emails.send({
      from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
      to: customerEmail,
      subject: `Warranty Registration ${data.doc_number ?? ""} from East Coast Mechanical`,
      text: `Hi ${data.customer_name},\n\nAttached is your warranty registration, including our standard 1-year craftsmanship warranty on the install.\n\nLet us know if you have any questions.\n\nEast Coast Mechanical`,
      attachments: [{ filename: `${data.doc_number ?? "warranty"}.pdf`, content: pdfBuffer }],
    });
    if (sendError) throw new Error(sendError.message);

    const { error: updateError } = await supabase
      .from("documents")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", id);
    if (updateError) throw new Error(updateError.message);

    revalidatePath(`/documents/${id}`);
    revalidatePath("/documents");
    return;
  }

  if (docType?.type === "contract") {
    const { data, customerEmail, error } = await getContractForPdf(id);
    if (error || !data) throw new Error(error ?? "Contract not found");
    if (!customerEmail) throw new Error("Customer has no email on file");

    const pdfBuffer = await renderContractPdf(data);

    const { error: sendError } = await resend.emails.send({
      from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
      to: customerEmail,
      subject: `Contract ${data.doc_number ?? ""} from East Coast Mechanical — signature needed`,
      text: `Hi ${data.customer_name},\n\nAttached is your service contract ${data.doc_number ?? ""} (${formatPrice(data.total ?? 0)}). Please log in to your customer portal to review and sign it before work begins.\n\nLet us know if you have any questions.\n\nEast Coast Mechanical`,
      attachments: [{ filename: `${data.doc_number ?? "contract"}.pdf`, content: pdfBuffer }],
    });
    if (sendError) throw new Error(sendError.message);

    const { error: updateError } = await supabase
      .from("documents")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", id);
    if (updateError) throw new Error(updateError.message);

    revalidatePath(`/documents/${id}`);
    revalidatePath("/documents");
    return;
  }

  const { data, customerEmail, dueDate, error } = await getDocumentForPdf(id);
  if (error || !data) throw new Error(error ?? "Document not found");
  if (!customerEmail) throw new Error("Customer has no email on file");

  const pdfBuffer = await renderDocumentPdf(data);
  const label = typeLabel[data.type] ?? "Document";

  const { error: sendError } = await resend.emails.send({
    from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
    to: customerEmail,
    subject: `${label} ${data.doc_number ?? ""} from East Coast Mechanical`,
    text: `Hi ${data.customer_name},\n\nAttached is your ${label.toLowerCase()} ${data.doc_number ?? ""} (Better tier total: ${formatPrice(
      data.totals.better
    )}).\n\nLet us know if you have any questions.\n\nEast Coast Mechanical`,
    attachments: [
      {
        filename: `${data.doc_number ?? label}.pdf`,
        content: pdfBuffer,
      },
    ],
  });

  if (sendError) throw new Error(sendError.message);

  const { error: updateError } = await supabase
    .from("documents")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      due_date: dueDateForSend(data.type, dueDate),
    })
    .eq("id", id);

  if (updateError) throw new Error(updateError.message);

  revalidatePath(`/documents/${id}`);
  revalidatePath("/documents");
}
