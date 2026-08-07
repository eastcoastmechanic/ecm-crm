"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { getServiceReportForPdf } from "@/lib/service-reports";
import { renderServiceReportPdf } from "@/lib/service-report-pdf";
import { resend, RESEND_FROM_EMAIL } from "@/lib/resend";
import { resolveCustomerPropertyEquipment } from "@/lib/customer-intake";

export async function assignCustomer(formData: FormData) {
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

  const resolved = await resolveCustomerPropertyEquipment({
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

  if (resolved.equipmentId) {
    const { error } = await supabase
      .from("diagnostics")
      .update({ equipment_id: resolved.equipmentId })
      .eq("id", diagnosticId);
    if (error) throw new Error(error.message);
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
}

export async function recordPartsUsed(formData: FormData) {
  const diagnosticId = formData.get("diagnostic_id") as string;
  const count = Number(formData.get("item_count")) || 0;

  const parts: { price_book_item_name: string; qty: number; unit_price: number | null }[] = [];
  for (let i = 0; i < count; i++) {
    const name = (formData.get(`name_${i}`) as string)?.trim();
    const qty = Number(formData.get(`qty_${i}`));
    if (!name || !qty) continue;
    const unitPriceRaw = formData.get(`unit_price_${i}`) as string;
    parts.push({
      price_book_item_name: name,
      qty,
      unit_price: unitPriceRaw ? Number(unitPriceRaw) : null,
    });
  }

  const { error } = await supabase
    .from("diagnostics")
    .update({ actual_parts_used: parts })
    .eq("id", diagnosticId);
  if (error) throw new Error(error.message);

  // Best-effort inventory deduction -- matched by price book item name since
  // tiers (good/better/best) are separate rows for the same physical part,
  // and inventory only tracks one row per part regardless of which tier id
  // it was originally added under.
  for (const part of parts) {
    const { data: matchingItems } = await supabase
      .from("price_book_items")
      .select("id")
      .eq("name", part.price_book_item_name);
    const ids = (matchingItems ?? []).map((r) => r.id);
    if (ids.length === 0) continue;

    const { data: invRow } = await supabase
      .from("inventory_items")
      .select("id, qty_on_hand")
      .in("price_book_item_id", ids)
      .limit(1)
      .maybeSingle();

    if (invRow) {
      const newQty = Math.max(0, invRow.qty_on_hand - part.qty);
      await supabase
        .from("inventory_items")
        .update({ qty_on_hand: newQty, updated_at: new Date().toISOString() })
        .eq("id", invRow.id);
    }
  }

  revalidatePath(`/diagnostics/${diagnosticId}`);
  revalidatePath("/inventory");
}

export async function sendServiceReportEmail(formData: FormData) {
  const id = formData.get("id") as string;

  const { data, customerEmail, error } = await getServiceReportForPdf(id);
  if (error || !data) throw new Error(error ?? "Service report not found");
  if (!customerEmail) throw new Error("Customer has no email on file");

  const pdfBuffer = await renderServiceReportPdf(data);

  const { error: sendError } = await resend.emails.send({
    from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
    to: customerEmail,
    subject: `Service Report ${data.doc_number ?? ""} from East Coast Mechanical`,
    text: `Hi ${data.customer_name},\n\nAttached is the service report from your recent visit${
      data.equipment_label ? ` for your ${data.equipment_label}` : ""
    }.\n\nLet us know if you have any questions.\n\nEast Coast Mechanical`,
    attachments: [
      {
        filename: `${data.doc_number ?? "service-report"}.pdf`,
        content: pdfBuffer,
      },
    ],
  });

  if (sendError) throw new Error(sendError.message);

  const { error: updateError } = await supabase
    .from("diagnostics")
    .update({ report_sent_at: new Date().toISOString() })
    .eq("id", id);

  if (updateError) throw new Error(updateError.message);

  revalidatePath(`/diagnostics/${id}`);
}
