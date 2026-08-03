"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { extractFromImage } from "@/lib/vision-extract";

const NameplateSchema = z.object({
  type: z.string().nullable(),
  brand: z.string().nullable(),
  model: z.string().nullable(),
  serial_number: z.string().nullable(),
  refrigerant_type: z.string().nullable(),
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

Only extract what is legibly printed on the plate. Leave any field null if it isn't shown or isn't readable.`
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
    })
    .eq("id", id);

  if (error) throw new Error(error.message);

  revalidatePath("/equipment");
}

export async function deleteEquipment(id: string): Promise<{ error?: string }> {
  const { error } = await supabase.from("equipment").delete().eq("id", id);

  if (error) {
    if (error.code === "23503") {
      return {
        error:
          "Can't delete — this equipment still has diagnostics or leads attached. Remove those first.",
      };
    }
    return { error: error.message };
  }

  revalidatePath("/equipment");
  return {};
}
