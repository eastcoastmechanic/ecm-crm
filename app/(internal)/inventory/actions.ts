"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { syncInventoryItemToGraph } from "@/lib/graph-connector";

export async function addInventoryItem(formData: FormData) {
  const price_book_item_id = (formData.get("price_book_item_id") as string) || null;
  const qty_on_hand = Number(formData.get("qty_on_hand")) || 0;
  const reorder_threshold = formData.get("reorder_threshold")
    ? Number(formData.get("reorder_threshold"))
    : null;

  if (!price_book_item_id) throw new Error("Select a price book item");

  const { data: item, error } = await supabase
    .from("inventory_items")
    .insert({
      price_book_item_id,
      qty_on_hand,
      reorder_threshold,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  if (item) await syncInventoryItemToGraph(item.id);

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

  await syncInventoryItemToGraph(id);

  revalidatePath("/inventory");
}
