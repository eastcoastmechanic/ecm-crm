"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { extractFromImage } from "@/lib/vision-extract";
import { cascadeUnlinkEquipment } from "@/lib/cascade-delete";

const NameplateSchema = z.object({
  type: z.string().nullable(),
  brand: z.string().nullable(),
  model: z.string().nullable(),
  serial_number: z.string().nullable(),
  refrigerant_type: z.string().nullable(),
  barcode: z.string().nullable(),
  // Everything else the plate carries. Free-form on purpose: plate layouts
  // differ by manufacturer and there's no value in dropping data just because
  // there isn't a column for it.
  nameplate: z
    .object({
      manufacture_date: z.string().nullable(),
      voltage: z.string().nullable(),
      phase: z.string().nullable(),
      refrigerant_charge: z.string().nullable(),
      btu_input: z.string().nullable(),
      btu_output: z.string().nullable(),
      seer: z.string().nullable(),
      ahri_number: z.string().nullable(),
    })
    .nullable(),
});

export type ScannedNameplate = z.infer<typeof NameplateSchema>;

export async function scanNameplate(formData: FormData): Promise<ScannedNameplate> {
  const photo = formData.get("photo") as File;
  if (!photo || photo.size === 0) throw new Error("No photo provided");

  return extractFromImage(
    photo,
    NameplateSchema,
    `You are reading a photo of an HVAC/plumbing equipment rating plate or nameplate (the metal/sticker label on the unit itself). Extract:
- type: the kind of equipment (e.g. "condenser", "furnace", "air handler", "mini-split", "tankless water heater", "boiler")
- brand: the manufacturer name printed on the label
- model: the model number
- serial_number: the serial number
- refrigerant_type: the refrigerant type if shown (e.g. "R-410A", "R-22", "R-32", "R-454B")
- barcode: the code printed beneath a barcode on the plate, without the surrounding asterisks. Plates often carry two — one encoding the model and one the serial. Prefer the one that is NOT simply a repeat of the serial number; if both repeat model and serial, use the model one.
- nameplate: the rest of the plate's technical data, each field null if not shown —
  manufacture_date (often "DATE OF MANUFACTURE", e.g. "Jul 2020"), voltage
  (e.g. "208/230"), phase (e.g. "1" or "3"), refrigerant_charge (with units,
  e.g. "16 LBS" or "7.26 kg"), btu_input, btu_output, seer, ahri_number.

Read only what is legibly printed. Leave any field null if it isn't shown or you can't read it confidently — a null is far better than a guessed model or serial, since those identify the physical unit. Rating plates are often photographed sideways or upside down; read them at whatever orientation they appear.`
  );
}

export async function addEquipment(formData: FormData) {
  const property_id = formData.get("property_id") as string;
  const type = (formData.get("type") as string)?.trim();
  const brand = (formData.get("brand") as string)?.trim();
  const model = (formData.get("model") as string)?.trim();
  const serial_number = (formData.get("serial_number") as string)?.trim();
  const refrigerant_type = (formData.get("refrigerant_type") as string)?.trim();
  const install_date = formData.get("install_date") as string;
  const warranty_expiration = formData.get("warranty_expiration") as string;
  const barcode = (formData.get("barcode") as string)?.trim();
  // JSON blob of everything else on the rating plate (voltage, BTU, SEER, ...)
  const nameplateRaw = (formData.get("nameplate") as string)?.trim();

  if (!property_id) {
    throw new Error("Property is required");
  }
  if (!type) {
    throw new Error("Equipment type is required");
  }

  const { error } = await supabase.from("equipment").insert({
    property_id,
    type,
    brand: brand || null,
    model: model || null,
    serial_number: serial_number || null,
    refrigerant_type: refrigerant_type || null,
    install_date: install_date || null,
    warranty_expiration: warranty_expiration || null,
    barcode: barcode || null,
    nameplate: nameplateRaw ? JSON.parse(nameplateRaw) : null,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/equipment");
}

export async function updateEquipment(formData: FormData) {
  const id = formData.get("id") as string;
  const property_id = formData.get("property_id") as string;
  const type = (formData.get("type") as string)?.trim();
  const brand = (formData.get("brand") as string)?.trim();
  const model = (formData.get("model") as string)?.trim();
  const serial_number = (formData.get("serial_number") as string)?.trim();
  const refrigerant_type = (formData.get("refrigerant_type") as string)?.trim();
  const install_date = formData.get("install_date") as string;
  const warranty_expiration = formData.get("warranty_expiration") as string;
  const barcode = (formData.get("barcode") as string)?.trim();
  // JSON blob of everything else on the rating plate (voltage, BTU, SEER, ...)
  const nameplateRaw = (formData.get("nameplate") as string)?.trim();

  if (!id) throw new Error("Missing equipment id");
  if (!property_id) throw new Error("Property is required");
  if (!type) throw new Error("Equipment type is required");

  const { error } = await supabase
    .from("equipment")
    .update({
      property_id,
      type,
      brand: brand || null,
      model: model || null,
      serial_number: serial_number || null,
      refrigerant_type: refrigerant_type || null,
      install_date: install_date || null,
      warranty_expiration: warranty_expiration || null,
      barcode: barcode || null,
      nameplate: nameplateRaw ? JSON.parse(nameplateRaw) : null,
    })
    .eq("id", id);

  if (error) throw new Error(error.message);

  revalidatePath("/equipment");
}

// Deletes equipment and its diagnostics; unlinks any leads that reference it.
export async function deleteEquipment(id: string): Promise<{ error?: string }> {
  await cascadeUnlinkEquipment([id]);

  const { error } = await supabase.from("equipment").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/equipment");
  revalidatePath("/properties");
  return {};
}
