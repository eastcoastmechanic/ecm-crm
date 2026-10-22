"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { extractFromImage } from "@/lib/vision-extract";
import { cascadeUnlinkEquipment } from "@/lib/cascade-delete";
import { requireOffice } from "@/lib/require-role";
import { readDataPlate } from "@/lib/pm/ocr";
import { NAMEPLATE_PHOTO_BUCKET, uploadPrivatePhoto } from "@/lib/pm/photos";
import {
  blankToNull,
  conflictMessage,
  mergeNameplateExtras,
  mergeNameplateIdentity,
  NAMEPLATE_FIELDS,
  type NameplateExtras,
  type NameplateField,
  type NameplateIdentity,
} from "@/lib/pm/nameplate";

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
  const manufactureDate = blankToNull(formData.get("manufacture_date") as string);

  if (!property_id) {
    throw new Error("Property is required");
  }
  if (!type) {
    throw new Error("Equipment type is required");
  }

  let nameplate: NameplateExtras | null = nameplateRaw ? JSON.parse(nameplateRaw) : null;
  if (manufactureDate) nameplate = { ...(nameplate ?? {}), manufacture_date: manufactureDate };

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
    nameplate,
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
  if (!id) throw new Error("Missing equipment id");
  if (!property_id) throw new Error("Property is required");
  if (!type) throw new Error("Equipment type is required");

  // Only columns present on the form are written. The edit form does not send
  // refrigerant, barcode, or nameplate, and clearing those here would wipe a
  // data plate the tech already confirmed.
  const patch: Record<string, string | null> = { property_id, type };
  const optional = ["brand", "model", "serial_number", "refrigerant_type", "install_date", "warranty_expiration", "barcode"] as const;
  for (const key of optional) {
    if (!formData.has(key)) continue;
    patch[key] = (formData.get(key) as string)?.trim() || null;
  }

  const { error } = await supabase.from("equipment").update(patch).eq("id", id);

  if (error) throw new Error(error.message);

  revalidatePath("/equipment");
}

// Deletes equipment and its diagnostics; unlinks any leads that reference it.
export async function deleteEquipment(id: string): Promise<{ error?: string }> {
  await requireOffice();
  await cascadeUnlinkEquipment([id]);

  const { error } = await supabase.from("equipment").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/equipment");
  revalidatePath("/properties");
  return {};
}

export async function scanDataPlate(equipmentId: string, formData: FormData) {
  const photo = formData.get("photo");
  if (!(photo instanceof File) || photo.size === 0) return { error: "Choose a photo of the data plate." };
  if (!photo.type.startsWith("image/")) return { error: "That file is not a photo." };
  if (photo.size > 4_500_000) return { error: "That photo is too large. Take it again." };
  try {
    const proposal = await readDataPlate(photo);
    const photoPath = await uploadPrivatePhoto(NAMEPLATE_PHOTO_BUCKET, photo, equipmentId);
    return { proposal, photoPath };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not read the plate" };
  }
}

function postedIdentity(formData: FormData): NameplateIdentity {
  const identity = {} as NameplateIdentity;
  for (const field of NAMEPLATE_FIELDS) identity[field] = blankToNull(formData.get(field) as string);
  return identity;
}

export async function confirmDataPlate(equipmentId: string, formData: FormData): Promise<{ error?: string }> {
  const { data, error } = await supabase
    .from("equipment")
    .select("brand, model, serial_number, type, refrigerant_type, nameplate")
    .eq("id", equipmentId)
    .single();
  if (error || !data) return { error: error?.message ?? "Equipment not found" };

  const stored = (data.nameplate ?? {}) as NameplateExtras;
  const existing: NameplateIdentity = {
    brand: data.brand,
    model: data.model,
    serial_number: data.serial_number,
    manufacture_date: blankToNull(stored.manufacture_date == null ? null : String(stored.manufacture_date)),
    type: data.type,
    refrigerant_type: data.refrigerant_type,
  };
  const confirmed = new Set<NameplateField>(
    NAMEPLATE_FIELDS.filter((field) => formData.get(`confirm_${field}`) === "1")
  );
  const merged = mergeNameplateIdentity(existing, postedIdentity(formData), confirmed);
  if (merged.conflicts.length > 0) return { error: conflictMessage(merged.conflicts) };

  let extras: NameplateExtras = {};
  const extrasRaw = formData.get("extras");
  if (typeof extrasRaw === "string" && extrasRaw.trim()) {
    try {
      const parsed = JSON.parse(extrasRaw) as NameplateExtras;
      if (parsed && typeof parsed === "object") extras = parsed;
    } catch {
      extras = {};
    }
  }
  const photoPath = blankToNull(formData.get("photo_path") as string);
  const nameplate = mergeNameplateExtras(stored, extras, photoPath);
  nameplate.manufacture_date = merged.next.manufacture_date;

  const { error: updateError } = await supabase
    .from("equipment")
    .update({
      brand: merged.next.brand,
      model: merged.next.model,
      serial_number: merged.next.serial_number,
      type: merged.next.type || data.type,
      refrigerant_type: merged.next.refrigerant_type,
      nameplate,
    })
    .eq("id", equipmentId);
  if (updateError) return { error: updateError.message };

  revalidatePath("/equipment");
  return {};
}
