"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";

export async function addEquipment(formData: FormData) {
  const property_id = formData.get("property_id") as string;
  const type = (formData.get("type") as string)?.trim();
  const brand = (formData.get("brand") as string)?.trim();
  const model = (formData.get("model") as string)?.trim();
  const serial_number = (formData.get("serial_number") as string)?.trim();
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
    install_date: install_date || null,
    warranty_expiration: warranty_expiration || null,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/equipment");
}
