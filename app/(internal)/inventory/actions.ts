"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";

export async function addInventoryItem(formData: FormData) {
  const price_book_item_id = (formData.get("price_book_item_id") as string) || null;
  const qty_on_hand = Number(formData.get("qty_on_hand")) || 0;
  const reorder_threshold = formData.get("reorder_threshold")
    ? Number(formData.get("reorder_threshold"))
    : null;

  if (!price_book_item_id) throw new Error("Select a price book item");

  const { error } = await supabase.from("inventory_items").insert({
    price_book_item_id,
    qty_on_hand,
    reorder_threshold,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/inventory");
}

export async function adjustInventoryQty(formData: FormData) {
  const id = formData.get("id") as string;
  const qty_on_hand = Number(formData.get("qty_on_hand"));

  const { error } = await supabase
    .from("inventory_items")
    .update({ qty_on_hand, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/inventory");
}
