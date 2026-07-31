"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { supabase } from "@/lib/supabase";
import { claude, CLAUDE_MODEL } from "@/lib/claude";
import { resolveCustomerPropertyEquipment } from "@/lib/customer-intake";
import { EQUIPMENT_LIFESPAN_REFERENCE } from "@/lib/equipment-lifespan-reference";
import { NEW_CUSTOMER_VALUE, NEW_PROPERTY_VALUE } from "../../../intake-constants";

const AssessmentItemSchema = z.object({
  condition_summary: z.string(),
  recommendation: z.enum(["no_action", "monitor", "repair", "replace"]),
  estimated_remaining_life_years: z.number().nullable(),
});

const AssessmentResultSchema = z.object({
  items: z.array(AssessmentItemSchema),
  overall_summary: z.string(),
});

async function nextAssessmentNumber() {
  const { count } = await supabase
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("type", "assessment");
  return `CA-${1001 + (count ?? 0)}`;
}

async function uploadPhotos(files: File[]) {
  const uploaded: { url: string; caption: string | null }[] = [];
  for (const file of files) {
    if (!file || file.size === 0) continue;
    const path = `${crypto.randomUUID()}-${file.name}`;
    const { error } = await supabase.storage.from("diagnostic-photos").upload(path, file, {
      contentType: file.type,
    });
    if (error) throw new Error(`Failed to upload photo: ${error.message}`);
    const { data: publicUrl } = supabase.storage.from("diagnostic-photos").getPublicUrl(path);
    uploaded.push({ url: publicUrl.publicUrl, caption: null });
  }
  return uploaded;
}

function computeAgeYears(installDate: string | null): number | null {
  if (!installDate) return null;
  const years = (Date.now() - new Date(installDate).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
  return Math.round(years * 10) / 10;
}

export async function submitAssessment(formData: FormData) {
  let customer_id = formData.get("customer_id") as string;
  let property_id = formData.get("property_id") as string;
  const rowCount = Number(formData.get("row_count") ?? 0);

  if (!customer_id) throw new Error("Customer is required");
  if (!property_id) throw new Error("Property is required");
  if (rowCount === 0) throw new Error("Add at least one piece of equipment");

  if (customer_id === NEW_CUSTOMER_VALUE) {
    const newCustomerName = (formData.get("new_customer_name") as string)?.trim();
    if (!newCustomerName) throw new Error("New customer name is required");
    const resolved = await resolveCustomerPropertyEquipment({
      customerName: newCustomerName,
      phone: (formData.get("new_customer_phone") as string)?.trim() || null,
      email: (formData.get("new_customer_email") as string)?.trim() || null,
      smsConsent: formData.get("new_customer_sms_consent") === "on",
    });
    customer_id = resolved.customerId!;
  }

  if (property_id === NEW_PROPERTY_VALUE) {
    const newAddress = (formData.get("new_property_address") as string)?.trim();
    if (!newAddress) throw new Error("New property address is required");
    const resolved = await resolveCustomerPropertyEquipment({
      customerId: customer_id,
      address: newAddress,
    });
    property_id = resolved.propertyId!;
  }

  type RowContext = {
    equipmentLabel: string;
    equipmentSerial: string | null;
    ageYears: number | null;
    condition: string;
    observations: string;
    photos: { url: string; caption: string | null }[];
    equipmentId: string | null;
  };

  const rows: RowContext[] = [];

  for (let i = 0; i < rowCount; i++) {
    const existingEquipmentId = (formData.get(`equipment_id_${i}`) as string) || null;
    const condition = (formData.get(`condition_${i}`) as string) || "working_well";
    const observations = ((formData.get(`observations_${i}`) as string) || "").trim();
    const photoFiles = formData.getAll(`photos_${i}`) as File[];

    let equipmentId = existingEquipmentId;
    let equipmentLabel: string;
    let equipmentSerial: string | null = null;
    let ageYears: number | null = null;

    if (existingEquipmentId) {
      const { data: existing } = await supabase
        .from("equipment")
        .select("type, brand, model, serial_number, install_date")
        .eq("id", existingEquipmentId)
        .single();
      equipmentLabel = existing
        ? [existing.type, existing.brand, existing.model].filter(Boolean).join(" ")
        : "Unknown equipment";
      equipmentSerial = existing?.serial_number ?? null;
      ageYears = existing ? computeAgeYears(existing.install_date) : null;
    } else {
      const newType = (formData.get(`new_equipment_type_${i}`) as string)?.trim();
      const newBrand = (formData.get(`new_equipment_brand_${i}`) as string)?.trim() || null;
      const newModel = (formData.get(`new_equipment_model_${i}`) as string)?.trim() || null;
      const newRefrigerant = (formData.get(`new_equipment_refrigerant_${i}`) as string) || null;
      if (!newType) throw new Error(`Equipment ${i + 1}: pick existing equipment or enter a type`);

      const resolved = await resolveCustomerPropertyEquipment({
        customerId: customer_id,
        propertyId: property_id,
        equipment: { type: newType, brand: newBrand, model: newModel, refrigerant_type: newRefrigerant },
      });
      equipmentId = resolved.equipmentId;
      equipmentLabel = [newType, newBrand, newModel].filter(Boolean).join(" ");
      equipmentSerial = null;
      ageYears = null;
    }

    const photos = await uploadPhotos(photoFiles);

    rows.push({ equipmentLabel, equipmentSerial, ageYears, condition, observations, photos, equipmentId });
  }

  const systemPrompt = `You are ECM's senior HVAC/plumbing technician writing up an equipment condition assessment for a customer's property, for East Coast Mechanical (ECM) in Plymouth, MA.

${EQUIPMENT_LIFESPAN_REFERENCE}

For each piece of equipment listed, write "condition_summary" (a clear, customer-readable paragraph on its current state), pick "recommendation" (no_action / monitor / repair / replace), and give "estimated_remaining_life_years" (null only if truly impossible to estimate). Then write "overall_summary": a short, plain-language paragraph covering the whole property's system health and priority order of any recommended work. Return exactly one item per piece of equipment listed, in the same order. Use plain ASCII punctuation only (hyphens, regular quotes) — no em dashes or other special unicode characters.`;

  const userMessage = rows
    .map(
      (r, i) => `Equipment ${i + 1}: ${r.equipmentLabel}${r.equipmentSerial ? ` (S/N ${r.equipmentSerial})` : ""}
Age: ${r.ageYears !== null ? `${r.ageYears} years` : "unknown"}
Tech's condition rating: ${r.condition.replace("_", " ")}
Tech's observations: ${r.observations || "none noted"}`
    )
    .join("\n\n");

  const response = await claude.messages.parse({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    output_config: {
      format: zodOutputFormat(AssessmentResultSchema),
    },
  });

  const parsed = response.parsed_output;
  if (!parsed) throw new Error("Claude did not return a parseable assessment. Try again.");
  if (parsed.items.length !== rows.length) {
    throw new Error("Claude returned a mismatched number of assessment items. Try again.");
  }

  const items = rows.map((row, i) => ({
    equipment_id: row.equipmentId,
    equipment_label: row.equipmentLabel,
    equipment_serial: row.equipmentSerial,
    age_years: row.ageYears,
    condition: row.condition,
    observations: row.observations,
    photos: row.photos,
    condition_summary: parsed.items[i].condition_summary,
    recommendation: parsed.items[i].recommendation,
    estimated_remaining_life_years: parsed.items[i].estimated_remaining_life_years,
  }));

  const doc_number = await nextAssessmentNumber();

  const { data: document, error } = await supabase
    .from("documents")
    .insert({
      doc_number,
      type: "assessment",
      customer_id,
      property_id,
      status: "draft",
      line_items: { items, overall_summary: parsed.overall_summary },
      ai_generated: true,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  revalidatePath("/documents");
  revalidatePath("/equipment");
  revalidatePath("/customers");
  revalidatePath("/properties");
  redirect(`/documents/${document.id}`);
}
