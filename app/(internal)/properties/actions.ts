"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";

export async function addProperty(formData: FormData) {
  const customer_id = formData.get("customer_id") as string;
  const address = (formData.get("address") as string)?.trim();
  const property_type = formData.get("property_type") as string;

  if (!customer_id) {
    throw new Error("Customer is required");
  }
  if (!address) {
    throw new Error("Address is required");
  }

  const { error } = await supabase.from("properties").insert({
    customer_id,
    address,
    property_type: property_type || null,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/properties");
}
