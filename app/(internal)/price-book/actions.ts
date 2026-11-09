"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { syncPriceBookItemToGraph, deletePriceBookItemFromGraph } from "@/lib/graph-connector";
import { requireOffice } from "@/lib/require-role";

const NOT_ALLOWED = { error: "Only the office or owner can change the price book." };

async function notOffice(): Promise<boolean> {
  try {
    await requireOffice();
    return false;
  } catch {
    return true;
  }
}

/** The item is already saved; a Copilot index hiccup is logged, not shown as a failed save. */
async function syncToGraph(id: string) {
  try {
    await syncPriceBookItemToGraph(id);
  } catch (err) {
    console.error("price book Graph sync failed", err instanceof Error ? err.message : err);
  }
}

/** Add a price book item. Returns { error } (never throws) so the form keeps what was typed. */
export async function addPriceBookItem(formData: FormData): Promise<{ error?: string }> {
  if (await notOffice()) return NOT_ALLOWED;
  const category = (formData.get("category") as string)?.trim();
  const tier = formData.get("tier") as string;
  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim();
  const unit_price = formData.get("unit_price") as string;
  const labor_hours = formData.get("labor_hours") as string;
  const unit_cost = formData.get("unit_cost") as string;

  if (!name) return { error: "Name is required." };

  const { data: item, error } = await supabase
    .from("price_book_items")
    .insert({
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
    })
    .select("id")
    .single();

  if (error) {
    console.error("addPriceBookItem failed", error.message);
    return { error: "Couldn't add the item. Try again." };
  }

  if (item) await syncToGraph(item.id);

  revalidatePath("/price-book");
  return {};
}

/** Edit a price book item. Returns { error } (never throws) so the form keeps what was typed. */
export async function updatePriceBookItem(formData: FormData): Promise<{ error?: string }> {
  if (await notOffice()) return NOT_ALLOWED;
  const id = formData.get("id") as string;
  const category = (formData.get("category") as string)?.trim();
  const tier = formData.get("tier") as string;
  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim();
  const unit_price = formData.get("unit_price") as string;
  const labor_hours = formData.get("labor_hours") as string;

  if (!id) return { error: "Missing item. Refresh and try again." };
  if (!name) return { error: "Name is required." };

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

  if (error) {
    console.error("updatePriceBookItem failed", error.message);
    return { error: "Couldn't save the item. Try again." };
  }

  await syncToGraph(id);

  revalidatePath("/price-book");
  return {};
}

export async function deletePriceBookItem(id: string): Promise<{ error?: string }> {
  if (await notOffice()) return NOT_ALLOWED;
  const { error } = await supabase.from("price_book_items").delete().eq("id", id);
  if (error) return { error: error.message };

  try {
    await deletePriceBookItemFromGraph(id);
  } catch (err) {
    console.error("price book Graph delete failed", err instanceof Error ? err.message : err);
  }

  revalidatePath("/price-book");
  return {};
}
