"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";

export async function addPriceBookItem(formData: FormData) {
  const category = (formData.get("category") as string)?.trim();
  const tier = formData.get("tier") as string;
  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim();
  const unit_price = formData.get("unit_price") as string;
  const labor_hours = formData.get("labor_hours") as string;

  if (!name) {
    throw new Error("Name is required");
  }

  const { error } = await supabase.from("price_book_items").insert({
    category: category || null,
    tier: tier || null,
    name,
    description: description || null,
    unit_price: unit_price ? Number(unit_price) : null,
    labor_hours: labor_hours ? Number(labor_hours) : null,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/price-book");
}
