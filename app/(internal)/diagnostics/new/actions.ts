"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { supabase } from "@/lib/supabase";
import { claude, CLAUDE_MODEL } from "@/lib/claude";
import { formatPriceBookForPrompt } from "@/lib/price-book";
import { HVAC_DIAGNOSTIC_REFERENCE } from "@/lib/hvac-reference";
import {
  computeSubcooling,
  computeSuperheat,
  REFRIGERANT_TYPES,
  type RefrigerantType,
} from "@/lib/refrigerant";

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

export async function generateDiagnosis(formData: FormData) {
  const equipment_id = formData.get("equipment_id") as string;
  const symptoms = (formData.get("symptoms") as string)?.trim();
  const refrigerantOverride = formData.get("refrigerant") as string;

  if (!equipment_id) throw new Error("Equipment is required");
  if (!symptoms) throw new Error("Describe the symptoms before generating a diagnosis");

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

  const [{ data: equipment }, { data: priceBookRows }] = await Promise.all([
    supabase
      .from("equipment")
      .select("*, properties(address, customers(name))")
      .eq("id", equipment_id)
      .single(),
    supabase.from("price_book_items").select("category, name, tier, unit_price"),
  ]);

  if (!equipment) throw new Error("Equipment not found");

  const refrigerant = isRefrigerantType(refrigerantOverride)
    ? refrigerantOverride
    : isRefrigerantType(equipment.refrigerant_type)
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

  const priceBookText = formatPriceBookForPrompt(priceBookRows ?? []);

  const systemPrompt = `You are ECM's senior HVAC/plumbing diagnostic technician, assisting a field tech for East Coast Mechanical (ECM) in Plymouth, MA.

Use the reference guide below (ECM's own field guide) as your primary grounding for interpreting superheat, subcooling, and symptom patterns. Combine it with the specific readings given to reach a diagnosis.

${HVAC_DIAGNOSTIC_REFERENCE}

Write "diagnosis" as a clear explanation of the likely fault, referencing the specific readings/calculations that support it. Write "suggested_fix" as the concrete repair steps a tech should take. For "suggested_line_items", select parts/labor from the price book below that the fix would require — reference the exact price book name in "price_book_item_name" when a good match exists; if nothing matches, leave it null and set your own reasonable description, noting "[custom item]" in notes. If the readings don't support a confident diagnosis (e.g. too few readings provided), say so plainly in "diagnosis" and suggest what additional readings to take, with suggested_line_items left empty.

PRICE BOOK (2026, USD, G=Good B=Better X=Best):
${priceBookText}`;

  const userMessage = `Equipment: ${equipment.type}${equipment.brand ? ` — ${equipment.brand}` : ""}${
    equipment.model ? ` ${equipment.model}` : ""
  }
Refrigerant: ${refrigerant ?? "unknown"}
Property: ${equipment.properties?.address ?? "unknown"}
Customer: ${equipment.properties?.customers?.name ?? "unknown"}

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

  const { data: diagnostic, error } = await supabase
    .from("diagnostics")
    .insert({
      equipment_id,
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

  revalidatePath("/diagnostics");
  redirect(`/diagnostics/${diagnostic.id}`);
}
