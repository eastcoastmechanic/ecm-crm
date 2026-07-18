"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";

export async function addCustomer(formData: FormData) {
  const name = (formData.get("name") as string)?.trim();
  const email = (formData.get("email") as string)?.trim();
  const phone = (formData.get("phone") as string)?.trim();
  const billing_address = (formData.get("billing_address") as string)?.trim();
  const notes = (formData.get("notes") as string)?.trim();

  if (!name) {
    throw new Error("Name is required");
  }

  const { error } = await supabase.from("customers").insert({
    name,
    email: email || null,
    phone: phone || null,
    billing_address: billing_address || null,
    notes: notes || null,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/customers");
}
