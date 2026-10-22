import { z } from "zod";
import { extractFromImage } from "@/lib/vision-extract";
import { decodeManufactureDate, type NameplateIdentity } from "@/lib/pm/nameplate";

const DataPlateSchema = z.object({
  manufacturer: z.string().nullable(),
  model: z.string().nullable(),
  serial_number: z.string().nullable(),
  manufacture_date: z.string().nullable(),
  equipment_type: z.string().nullable(),
  refrigerant_type: z.string().nullable(),
  voltage: z.string().nullable(),
  phase: z.string().nullable(),
  refrigerant_charge: z.string().nullable(),
  btu_input: z.string().nullable(),
  btu_output: z.string().nullable(),
  seer: z.string().nullable(),
  ahri_number: z.string().nullable(),
});

export type DataPlateProposal = {
  identity: NameplateIdentity;
  /** Where the date came from, so the tech can tell a printed date from a serial decode. */
  manufacture_date_source: "printed" | "serial" | null;
  extras: Record<string, string | null>;
};

const PROMPT = `You are reading a photo of an HVAC equipment data plate (the metal or sticker rating label on the unit). Extract only what is legibly printed:
- manufacturer: the brand name
- model: the model number
- serial_number: the serial number
- manufacture_date: a date printed on the plate (for example "DATE OF MANUFACTURE Jul 2020"). Do not invent a date by decoding the serial — leave this null when no date is printed.
- equipment_type: condenser, furnace, air handler, heat pump, rooftop unit, boiler, or similar
- refrigerant_type: for example R-410A, R-32, R-454B, R-22
- voltage, phase, refrigerant_charge, btu_input, btu_output, seer, ahri_number: null when not shown

Plates are often photographed sideways. Read them at whatever orientation they appear. A null is better than a guessed model or serial.`;

/**
 * Vision extraction for a data plate.
 *
 * Uses Claude (ANTHROPIC_API_KEY), the same multimodal API the CRM already
 * uses for nameplates. No OCR binary and no extra vendor: the call runs inside
 * a Vercel serverless function. This function only returns a proposal.
 */
export async function readDataPlate(file: File): Promise<DataPlateProposal> {
  const parsed = await extractFromImage(file, DataPlateSchema, PROMPT);
  const printed = parsed.manufacture_date?.trim() || null;
  const decoded = printed ? null : decodeManufactureDate(parsed.manufacturer, parsed.serial_number);
  return {
    identity: {
      brand: parsed.manufacturer?.trim() || null,
      model: parsed.model?.trim() || null,
      serial_number: parsed.serial_number?.trim() || null,
      manufacture_date: printed ?? decoded,
      type: parsed.equipment_type?.trim() || null,
      refrigerant_type: parsed.refrigerant_type?.trim() || null,
    },
    manufacture_date_source: printed ? "printed" : decoded ? "serial" : null,
    extras: {
      manufacture_date: printed ?? decoded,
      voltage: parsed.voltage,
      phase: parsed.phase,
      refrigerant_charge: parsed.refrigerant_charge,
      btu_input: parsed.btu_input,
      btu_output: parsed.btu_output,
      seer: parsed.seer,
      ahri_number: parsed.ahri_number,
    },
  };
}
