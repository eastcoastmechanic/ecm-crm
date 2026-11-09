"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { supabase } from "@/lib/supabase";
import { claude, CLAUDE_MODEL_BALANCED } from "@/lib/claude";
import { resolveCustomerPropertyEquipment } from "@/lib/customer-intake";
import { EQUIPMENT_LIFESPAN_REFERENCE } from "@/lib/equipment-lifespan-reference";
import { NEW_CUSTOMER_VALUE, NEW_PROPERTY_VALUE } from "../../../intake-constants";
import { requireOffice } from "@/lib/require-role";
import { reusableEquipmentId } from "@/lib/reuse-equipment";

const AssessmentItemSchema = z.object({
  condition_summary: z.string(),
  recommendation: z.enum(["no_action", "monitor", "repair", "replace"]),
  estimated_remaining_life_years: z.number().nullable(),
});

const AssessmentResultSchema = z.object({
  items: z.array(AssessmentItemSchema),
  overall_summary: z.string(),
});

/**
 * customerId / propertyId / equipmentIds (by row index) come back when new records
 * were saved but a later step failed, so the form reuses them and a retry does not
 * create a second copy.
 */
export type AssessmentFormState = {
  error?: string;
  customerId?: string;
  propertyId?: string;
  equipmentIds?: (string | null)[];
} | null;

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function nextAssessmentNumber() {
  const { count } = await supabase
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("type", "assessment");
  return `CA-${1001 + (count ?? 0)}`;
}

/** Throws on a storage error; submitAssessment turns that into { error }. */
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

/**
 * New condition assessment. Asks Claude for the write-up first and only then saves
 * customers, equipment and photos, so an AI failure creates nothing. Returns { error }
 * for expected problems (the form keeps what was typed); redirects on success.
 */
export async function submitAssessment(_prev: AssessmentFormState, formData: FormData): Promise<AssessmentFormState> {
  try {
    await requireOffice();
  } catch {
    return { error: "Only the office or owner can create assessments." };
  }
  let customer_id = formData.get("customer_id") as string;
  let property_id = formData.get("property_id") as string;
  const rowCount = Number(formData.get("row_count") ?? 0);
  const newCustomerName = (formData.get("new_customer_name") as string)?.trim();
  const newAddress = (formData.get("new_property_address") as string)?.trim();

  if (!customer_id) return { error: "Pick a customer." };
  if (!property_id) return { error: "Pick a property." };
  if (rowCount === 0) return { error: "Add at least one piece of equipment." };
  if (customer_id === NEW_CUSTOMER_VALUE && !newCustomerName) return { error: "Type the new customer's name." };
  if (property_id === NEW_PROPERTY_VALUE && !newAddress) return { error: "Type the new property's address." };

  type RowContext = {
    equipmentLabel: string;
    equipmentSerial: string | null;
    ageYears: number | null;
    condition: string;
    observations: string;
    photoFiles: File[];
    existingEquipmentId: string | null;
    newEquipment: { type: string; brand: string | null; model: string | null; refrigerant_type: string | null } | null;
  };

  // Read every row first. Nothing is written until Claude has answered.
  const rows: RowContext[] = [];
  for (let i = 0; i < rowCount; i++) {
    const existingEquipmentId = (formData.get(`equipment_id_${i}`) as string) || null;
    const condition = (formData.get(`condition_${i}`) as string) || "working_well";
    const observations = ((formData.get(`observations_${i}`) as string) || "").trim();
    const photoFiles = formData.getAll(`photos_${i}`) as File[];

    if (existingEquipmentId) {
      const { data: existing } = await supabase
        .from("equipment")
        .select("type, brand, model, serial_number, install_date")
        .eq("id", existingEquipmentId)
        .single();
      rows.push({
        equipmentLabel: existing ? [existing.type, existing.brand, existing.model].filter(Boolean).join(" ") : "Unknown equipment",
        equipmentSerial: existing?.serial_number ?? null,
        ageYears: existing ? computeAgeYears(existing.install_date) : null,
        condition,
        observations,
        photoFiles,
        existingEquipmentId,
        newEquipment: null,
      });
    } else {
      const newType = (formData.get(`new_equipment_type_${i}`) as string)?.trim();
      const newBrand = (formData.get(`new_equipment_brand_${i}`) as string)?.trim() || null;
      const newModel = (formData.get(`new_equipment_model_${i}`) as string)?.trim() || null;
      const newRefrigerant = (formData.get(`new_equipment_refrigerant_${i}`) as string) || null;
      if (!newType) return { error: `Equipment ${i + 1}: pick existing equipment or type what it is.` };
      rows.push({
        equipmentLabel: [newType, newBrand, newModel].filter(Boolean).join(" "),
        equipmentSerial: null,
        ageYears: null,
        condition,
        observations,
        photoFiles,
        existingEquipmentId: null,
        newEquipment: { type: newType, brand: newBrand, model: newModel, refrigerant_type: newRefrigerant },
      });
    }
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

  const AI_FAILED = "Couldn't get the write-up from Claude. Nothing was saved and your entries are below, try again.";
  let parsed: z.infer<typeof AssessmentResultSchema> | null;
  try {
    const response = await claude.messages.parse({
      model: CLAUDE_MODEL_BALANCED,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      output_config: {
        format: zodOutputFormat(AssessmentResultSchema),
      },
    });
    parsed = response.parsed_output;
  } catch (err) {
    console.error("submitAssessment: Claude call failed", errText(err));
    return { error: AI_FAILED };
  }
  if (!parsed || parsed.items.length !== rows.length) return { error: AI_FAILED };

  const createdCustomer = customer_id === NEW_CUSTOMER_VALUE;
  const createdProperty = property_id === NEW_PROPERTY_VALUE;
  // What to hand back if a later step fails: the records already saved.
  const saved = (): AssessmentFormState => {
    revalidatePath("/customers");
    revalidatePath("/properties");
    revalidatePath("/equipment");
    revalidatePath("/documents/assessment/new");
    return {
      ...(createdCustomer && customer_id !== NEW_CUSTOMER_VALUE ? { customerId: customer_id } : {}),
      ...(createdProperty && property_id !== NEW_PROPERTY_VALUE ? { propertyId: property_id } : {}),
      ...(createdEquipment.some(Boolean) ? { equipmentIds: createdEquipment } : {}),
    };
  };
  // New equipment saved so far, by row index, handed back on failure so a retry reuses it.
  const createdEquipment: (string | null)[] = rows.map(() => null);
  const savedNote = () =>
    (createdCustomer || createdProperty ? " The new customer/property was saved and is picked below." : "") +
    (createdEquipment.some(Boolean) ? " Equipment already saved will be reused, not added twice." : "");

  if (createdCustomer) {
    try {
      const resolved = await resolveCustomerPropertyEquipment({
        customerName: newCustomerName,
        phone: (formData.get("new_customer_phone") as string)?.trim() || null,
        email: (formData.get("new_customer_email") as string)?.trim() || null,
        smsConsent: formData.get("new_customer_sms_consent") === "on",
      });
      customer_id = resolved.customerId!;
    } catch (err) {
      console.error("submitAssessment: new customer failed", errText(err));
      return { error: "Couldn't save the new customer. Nothing was created, try again." };
    }
  }

  if (createdProperty) {
    try {
      const resolved = await resolveCustomerPropertyEquipment({ customerId: customer_id, address: newAddress });
      property_id = resolved.propertyId!;
    } catch (err) {
      console.error("submitAssessment: new property failed", errText(err));
      return { ...saved(), error: `Couldn't save the new property. Try again.${savedNote()}` };
    }
  }

  const items = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let equipmentId = row.existingEquipmentId;
    let photos: { url: string; caption: string | null }[];
    try {
      if (row.newEquipment) {
        // Reuse equipment an earlier failed try already saved for this row.
        equipmentId = await reusableEquipmentId(formData.get(`created_equipment_id_${i}`), property_id);
        if (!equipmentId) {
          const resolved = await resolveCustomerPropertyEquipment({
            customerId: customer_id,
            propertyId: property_id,
            equipment: row.newEquipment,
          });
          equipmentId = resolved.equipmentId;
        }
        createdEquipment[i] = equipmentId;
      }
      photos = await uploadPhotos(row.photoFiles);
    } catch (err) {
      console.error("submitAssessment: equipment/photo save failed", errText(err));
      return {
        ...saved(),
        error: `Couldn't save equipment ${i + 1} or its photos. Try again (or with fewer photos).${savedNote()}`,
      };
    }
    items.push({
      equipment_id: equipmentId,
      equipment_label: row.equipmentLabel,
      equipment_serial: row.equipmentSerial,
      age_years: row.ageYears,
      condition: row.condition,
      observations: row.observations,
      photos,
      condition_summary: parsed.items[i].condition_summary,
      recommendation: parsed.items[i].recommendation,
      estimated_remaining_life_years: parsed.items[i].estimated_remaining_life_years,
    });
  }

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

  if (error || !document) {
    console.error("submitAssessment: insert failed", error?.message);
    return { ...saved(), error: `Couldn't save the assessment. Your entries are below, try again.${savedNote()}` };
  }

  revalidatePath("/documents");
  revalidatePath("/equipment");
  revalidatePath("/customers");
  revalidatePath("/properties");
  redirect(`/documents/${document.id}`);
}
