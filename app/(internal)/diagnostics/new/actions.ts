"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { supabase } from "@/lib/supabase";
import { claude, CLAUDE_MODEL } from "@/lib/claude";
import { extractFromImage } from "@/lib/vision-extract";
import { resolveCustomerPropertyEquipment } from "@/lib/customer-intake";
import { fetchAllPriceBookItems, formatPriceBookForPrompt } from "@/lib/price-book";
import { HVAC_DIAGNOSTIC_REFERENCE } from "@/lib/hvac-reference";
import {
  computeSubcooling,
  computeSuperheat,
  REFRIGERANT_TYPES,
  type RefrigerantType,
} from "@/lib/refrigerant";
import { syncJobToPlanner } from "@/lib/planner-connector";

const ScannedReadingsSchema = z.object({
  outdoor_temp: z.number().nullable(),
  indoor_temp: z.number().nullable(),
  supply_air_temp: z.number().nullable(),
  return_air_temp: z.number().nullable(),
  indoor_rh: z.number().nullable(),
  suction_pressure: z.number().nullable(),
  liquid_pressure: z.number().nullable(),
  suction_line_temp: z.number().nullable(),
  liquid_line_temp: z.number().nullable(),
  discharge_pressure: z.number().nullable(),
  discharge_temp: z.number().nullable(),
  amp_draw: z.number().nullable(),
  voltage: z.number().nullable(),
});

export type ScannedReadings = z.infer<typeof ScannedReadingsSchema>;

export async function scanReadingPhoto(formData: FormData): Promise<ScannedReadings> {
  const photo = formData.get("photo") as File;
  if (!photo || photo.size === 0) throw new Error("No photo provided");

  return extractFromImage(
    photo,
    ScannedReadingsSchema,
    `You are reading a photo of an HVAC diagnostic tool display, refrigerant gauge manifold, or multimeter, held by a field technician on a job. Extract any of these values that are legibly displayed:
- outdoor_temp, indoor_temp, supply_air_temp, return_air_temp (°F)
- indoor_rh (relative humidity %)
- suction_pressure, liquid_pressure, discharge_pressure (PSIG)
- suction_line_temp, liquid_line_temp, discharge_temp (°F)
- amp_draw (compressor amp draw, A)
- voltage (line voltage, V)

Only extract values you can clearly read on the device's display or gauge. Leave anything not shown as null. Do not guess.`
  );
}

const SuggestedLineItemSchema = z.object({
  price_book_item_name: z.string().nullable(),
  description: z.string(),
  qty: z.number(),
  unit: z.string(),
  notes: z.string().nullable(),
});

const DiagnosisSchema = z.object({
  diagnosis: z.string(),
  suggested_fix: z.string(),
  suggested_line_items: z.array(SuggestedLineItemSchema),
});

function parseNullableNumber(value: FormDataEntryValue | null): number | null {
  if (value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isRefrigerantType(value: string | null): value is RefrigerantType {
  return !!value && (REFRIGERANT_TYPES as string[]).includes(value);
}

async function nextReportNumber() {
  const { count } = await supabase.from("diagnostics").select("id", { count: "exact", head: true });
  return `RPT-${1001 + (count ?? 0)}`;
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

export async function generateDiagnosis(formData: FormData) {
  const submittedEquipmentId = (formData.get("equipment_id") as string) || null;
  const job_id = (formData.get("job_id") as string) || null;
  const symptoms = (formData.get("symptoms") as string)?.trim();
  const refrigerantOverride = formData.get("refrigerant") as string;
  const photoFiles = formData.getAll("photos") as File[];

  const customerName = (formData.get("customer_name") as string)?.trim() || null;
  const customerPhone = (formData.get("customer_phone") as string)?.trim() || null;
  const customerAddress = (formData.get("customer_address") as string)?.trim() || null;
  const smsConsent = formData.get("sms_consent") === "on";
  const newEquipmentType = (formData.get("new_equipment_type") as string)?.trim() || null;
  const newEquipmentBrand = (formData.get("new_equipment_brand") as string)?.trim() || null;
  const newEquipmentModel = (formData.get("new_equipment_model") as string)?.trim() || null;
  const newEquipmentRefrigerant = (formData.get("new_equipment_refrigerant") as string) || null;

  if (!symptoms) throw new Error("Describe the symptoms before generating a diagnosis");

  let equipment_id = submittedEquipmentId;
  let resolvedCustomerId: string | null = null;
  let resolvedPropertyId: string | null = null;
  let walkInCustomerName: string | null = null;
  let walkInAddress: string | null = null;

  if (!equipment_id && customerName && customerAddress) {
    const resolved = await resolveCustomerPropertyEquipment({
      customerName,
      phone: customerPhone,
      smsConsent,
      address: customerAddress,
      equipment: newEquipmentType
        ? {
            type: newEquipmentType,
            brand: newEquipmentBrand,
            model: newEquipmentModel,
            refrigerant_type: newEquipmentRefrigerant,
          }
        : null,
    });
    resolvedCustomerId = resolved.customerId;
    resolvedPropertyId = resolved.propertyId;
    equipment_id = resolved.equipmentId;
    walkInCustomerName = customerName;
    walkInAddress = customerAddress;
  }

  const readings = {
    outdoor_temp: parseNullableNumber(formData.get("outdoor_temp")),
    indoor_temp: parseNullableNumber(formData.get("indoor_temp")),
    supply_air_temp: parseNullableNumber(formData.get("supply_air_temp")),
    return_air_temp: parseNullableNumber(formData.get("return_air_temp")),
    indoor_rh: parseNullableNumber(formData.get("indoor_rh")),
    suction_pressure: parseNullableNumber(formData.get("suction_pressure")),
    liquid_pressure: parseNullableNumber(formData.get("liquid_pressure")),
    suction_line_temp: parseNullableNumber(formData.get("suction_line_temp")),
    liquid_line_temp: parseNullableNumber(formData.get("liquid_line_temp")),
    discharge_pressure: parseNullableNumber(formData.get("discharge_pressure")),
    discharge_temp: parseNullableNumber(formData.get("discharge_temp")),
    amp_draw: parseNullableNumber(formData.get("amp_draw")),
    voltage: parseNullableNumber(formData.get("voltage")),
  };

  const [{ data: equipment }, priceBookRows] = await Promise.all([
    equipment_id
      ? supabase
          .from("equipment")
          .select("*, properties(id, customer_id, address, customers(name))")
          .eq("id", equipment_id)
          .single()
      : Promise.resolve({ data: null }),
    fetchAllPriceBookItems(supabase, "category, name, tier, unit_price"),
  ]);

  if (equipment) {
    resolvedCustomerId = equipment.properties?.customer_id ?? resolvedCustomerId;
    resolvedPropertyId = equipment.properties?.id ?? resolvedPropertyId;
  }

  const refrigerant = isRefrigerantType(refrigerantOverride)
    ? refrigerantOverride
    : equipment && isRefrigerantType(equipment.refrigerant_type)
      ? (equipment.refrigerant_type as RefrigerantType)
      : null;

  const superheat = refrigerant
    ? computeSuperheat(refrigerant, readings.suction_pressure, readings.suction_line_temp)
    : null;
  const subcooling = refrigerant
    ? computeSubcooling(refrigerant, readings.liquid_pressure, readings.liquid_line_temp)
    : null;
  const tempSplit =
    readings.return_air_temp !== null && readings.supply_air_temp !== null
      ? Math.round((readings.return_air_temp - readings.supply_air_temp) * 10) / 10
      : null;

  const priceBookText = formatPriceBookForPrompt(priceBookRows);

  const systemPrompt = `You are ECM's senior HVAC/plumbing diagnostic technician, assisting a field tech for East Coast Mechanical (ECM) in Plymouth, MA.

Use the reference guide below (ECM's own field guide) as your primary grounding for interpreting superheat, subcooling, and symptom patterns. Combine it with the specific readings given to reach a diagnosis.

${HVAC_DIAGNOSTIC_REFERENCE}

Write "diagnosis" as a clear explanation of the likely fault, referencing the specific readings/calculations that support it. Write "suggested_fix" as the concrete repair steps a tech should take. For "suggested_line_items", select parts/labor from the price book below that the fix would require — reference the exact price book name in "price_book_item_name" when a good match exists; if nothing matches, leave it null and set your own reasonable description, noting "[custom item]" in notes. If the readings don't support a confident diagnosis (e.g. too few readings provided), say so plainly in "diagnosis" and suggest what additional readings to take, with suggested_line_items left empty.

PRICE BOOK (2026, USD, G=Good B=Better X=Best):
${priceBookText}`;

  const equipmentLabel = equipment
    ? `${equipment.type}${equipment.brand ? ` — ${equipment.brand}` : ""}${equipment.model ? ` ${equipment.model}` : ""}`
    : newEquipmentType ?? "unknown (not yet on file)";

  const userMessage = `Equipment: ${equipmentLabel}
Refrigerant: ${refrigerant ?? "unknown"}
Property: ${equipment?.properties?.address ?? walkInAddress ?? "unknown"}
Customer: ${equipment?.properties?.customers?.name ?? walkInCustomerName ?? "unknown (not yet identified)"}

Symptoms reported by tech:
${symptoms}

Operating conditions:
Outdoor temp: ${readings.outdoor_temp ?? "—"}F, Indoor temp: ${readings.indoor_temp ?? "—"}F
Supply air: ${readings.supply_air_temp ?? "—"}F, Return air: ${readings.return_air_temp ?? "—"}F
Indoor RH: ${readings.indoor_rh ?? "—"}%
Temp split (return - supply): ${tempSplit ?? "—"}F (target 16-22F)

Pressure readings:
Suction pressure: ${readings.suction_pressure ?? "—"} PSIG, Suction line temp: ${readings.suction_line_temp ?? "—"}F
Liquid pressure: ${readings.liquid_pressure ?? "—"} PSIG, Liquid line temp: ${readings.liquid_line_temp ?? "—"}F
Discharge pressure: ${readings.discharge_pressure ?? "—"} PSIG, Discharge temp: ${readings.discharge_temp ?? "—"}F

Calculated (from ECM's PT chart, already computed — trust these over your own estimate):
Superheat: ${superheat ?? "—"}F
Subcooling: ${subcooling ?? "—"}F

Electrical:
Compressor amp draw: ${readings.amp_draw ?? "—"}A, Line voltage: ${readings.voltage ?? "—"}V

Diagnose the fault and suggest a fix.`;

  const response = await claude.messages.parse({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    output_config: {
      format: zodOutputFormat(DiagnosisSchema),
    },
  });

  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error("Claude did not return a parseable diagnosis. Try again.");
  }

  const [photos, doc_number] = await Promise.all([uploadPhotos(photoFiles), nextReportNumber()]);

  const { data: diagnostic, error } = await supabase
    .from("diagnostics")
    .insert({
      equipment_id,
      job_id,
      doc_number,
      photos,
      readings: {
        ...readings,
        refrigerant,
        superheat,
        subcooling,
        temp_split: tempSplit,
        symptoms,
      },
      ai_diagnosis: parsed.diagnosis,
      suggested_fix: parsed.suggested_fix,
      suggested_line_items: parsed.suggested_line_items,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  if (job_id) {
    const { data: job } = await supabase
      .from("jobs")
      .select("status, customer_id, property_id")
      .eq("id", job_id)
      .single();

    if (job) {
      const updates: Record<string, string> = {};
      if (!job.customer_id && resolvedCustomerId) updates.customer_id = resolvedCustomerId;
      if (!job.property_id && resolvedPropertyId) updates.property_id = resolvedPropertyId;
      if (Object.keys(updates).length) {
        await supabase.from("jobs").update(updates).eq("id", job_id);
      }

      // Resyncs the job's Planner card against its current status. Matters
      // most when the job was already marked complete before this diagnostic
      // existed -- its card would be stuck in Needs Attention otherwise, with
      // nothing else to ever move it to Finished.
      await syncJobToPlanner(job_id, job.status);
    }
  }

  revalidatePath("/diagnostics");
  revalidatePath("/customers");
  revalidatePath("/properties");
  revalidatePath("/equipment");
  if (job_id) revalidatePath("/jobs");
  redirect(`/diagnostics/${diagnostic.id}`);
}
