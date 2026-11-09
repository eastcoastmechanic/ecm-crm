"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { syncInventoryItemToGraph } from "@/lib/graph-connector";
import { requireOffice } from "@/lib/require-role";

const NOT_ALLOWED = { error: "Only the office or owner can change inventory." };

async function notOffice(): Promise<boolean> {
  try {
    await requireOffice();
    return false;
  } catch {
    return true;
  }
}

/** The row is already saved; a Copilot index hiccup is logged, not shown as a failed save. */
async function syncToGraph(id: string) {
  try {
    await syncInventoryItemToGraph(id);
  } catch (err) {
    console.error("inventory Graph sync failed", err instanceof Error ? err.message : err);
  }
}

/** Track a new part. Returns { error } (never throws) so the form keeps what was typed. */
export async function addInventoryItem(formData: FormData): Promise<{ error?: string }> {
  if (await notOffice()) return NOT_ALLOWED;
  const price_book_item_id = (formData.get("price_book_item_id") as string) || null;
  const qty_on_hand = Number(formData.get("qty_on_hand")) || 0;
  const reorder_threshold = formData.get("reorder_threshold")
    ? Number(formData.get("reorder_threshold"))
    : null;

  if (!price_book_item_id) return { error: "Pick a price book item." };

  const { data: item, error } = await supabase
    .from("inventory_items")
    .insert({
      price_book_item_id,
      qty_on_hand,
      reorder_threshold,
    })
    .select("id")
    .single();
  if (error) {
    console.error("addInventoryItem failed", error.message);
    return { error: "Couldn't add the part. It may already be tracked. Try again." };
  }

  if (item) await syncToGraph(item.id);

  revalidatePath("/inventory");
  return {};
}

/** Set the on-hand count. Returns { error } (never throws). */
export async function adjustInventoryQty(formData: FormData): Promise<{ error?: string }> {
  if (await notOffice()) return NOT_ALLOWED;
  const id = formData.get("id") as string;
  const raw = formData.get("qty_on_hand") as string;
  const qty_on_hand = Number(raw);
  if (!id) return { error: "Missing part. Refresh and try again." };
  if (raw === "" || raw === null || !Number.isFinite(qty_on_hand) || qty_on_hand < 0) {
    return { error: "Type a count of 0 or more." };
  }

  const { error } = await supabase
    .from("inventory_items")
    .update({ qty_on_hand, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    console.error("adjustInventoryQty failed", error.message);
    return { error: "Couldn't save the count. Try again." };
  }

  await syncToGraph(id);

  revalidatePath("/inventory");
  return {};
}
