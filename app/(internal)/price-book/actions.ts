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
  const unit_cost = formData.get("unit_cost") as string;

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
    // Cost is only ever submitted by owner-role users -- the field is
    // absent from the form entirely for anyone else, which is fine here
    // since this is a brand-new row with nothing to preserve.
    unit_cost: unit_cost ? Number(unit_cost) : null,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/price-book");
}

export async function updatePriceBookItem(formData: FormData) {
  const id = formData.get("id") as string;
  const category = (formData.get("category") as string)?.trim();
  const tier = formData.get("tier") as string;
  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim();
  const unit_price = formData.get("unit_price") as string;
  const labor_hours = formData.get("labor_hours") as string;

  if (!id) throw new Error("Missing item id");
  if (!name) throw new Error("Name is required");

  const update: Record<string, unknown> = {
    category: category || null,
    tier: tier || null,
    name,
    description: description || null,
    unit_price: unit_price ? Number(unit_price) : null,
    labor_hours: labor_hours ? Number(labor_hours) : null,
  };
  // Cost is only ever rendered as a field for owner-role users -- when it's
  // absent from the submission (any other role editing this item), leave
  // the column untouched instead of treating the missing field as "clear it".
  if (formData.has("unit_cost")) {
    const unit_cost = formData.get("unit_cost") as string;
    update.unit_cost = unit_cost ? Number(unit_cost) : null;
  }

  const { error } = await supabase.from("price_book_items").update(update).eq("id", id);

  if (error) throw new Error(error.message);

  revalidatePath("/price-book");
}

export async function deletePriceBookItem(id: string): Promise<{ error?: string }> {
  const { error } = await supabase.from("price_book_items").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/price-book");
  return {};
}
