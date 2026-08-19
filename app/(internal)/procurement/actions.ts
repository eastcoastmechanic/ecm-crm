"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";

export async function createPurchaseOrder(formData: FormData) {
  const vendor = (formData.get("vendor") as string)?.trim();
  const po_number = (formData.get("po_number") as string)?.trim() || null;
  const job_id = (formData.get("job_id") as string) || null;
  const notes = (formData.get("notes") as string)?.trim() || null;
  const description = (formData.get("description") as string)?.trim() || "";
  const qty = Number(formData.get("qty")) || 0;
  const unit_cost = Number(formData.get("unit_cost")) || 0;

  if (!vendor) throw new Error("Vendor is required");

  const line_items = description || qty || unit_cost ? [{ description, qty, unit_cost }] : [];
  const total_cost = qty && unit_cost ? Math.round(qty * unit_cost * 100) / 100 : null;

  const { error } = await supabase.from("purchase_orders").insert({
    vendor,
    po_number,
    job_id,
    notes,
    line_items,
    total_cost,
  });

  if (error) throw new Error(error.message);

  revalidatePath("/procurement");
}

export async function updatePoStatus(formData: FormData) {
  const id = formData.get("id") as string;
  const status = formData.get("status") as string;

  const { data: existing, error: fetchError } = await supabase
    .from("purchase_orders")
    .select("ordered_at, received_at, delivered_at")
    .eq("id", id)
    .single();
  if (fetchError) throw new Error(fetchError.message);

  const now = new Date().toISOString();
  // Stamp once, same as jobs.arrived_at/completed_at -- bouncing the status
  // select around shouldn't move an already-recorded timestamp.
  const ordered_at = status === "ordered" ? (existing.ordered_at ?? now) : existing.ordered_at;
  const received_at = status === "received" ? (existing.received_at ?? now) : existing.received_at;
  const delivered_at = status === "delivered" ? (existing.delivered_at ?? now) : existing.delivered_at;

  const { error } = await supabase
    .from("purchase_orders")
    .update({ status, ordered_at, received_at, delivered_at })
    .eq("id", id);

  if (error) throw new Error(error.message);

  revalidatePath("/procurement");
}

export async function deletePurchaseOrder(id: string): Promise<{ error?: string }> {
  const { error } = await supabase.from("purchase_orders").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/procurement");
  return {};
}
