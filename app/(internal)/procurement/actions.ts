"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { requireOffice } from "@/lib/require-role";

const NOT_ALLOWED = { error: "Only the office or owner can change purchase orders." };

async function notOffice(): Promise<boolean> {
  try {
    await requireOffice();
    return false;
  } catch {
    return true;
  }
}

/** New purchase order. Returns { error } (never throws) so the form keeps what was typed. */
export async function createPurchaseOrder(formData: FormData): Promise<{ error?: string }> {
  if (await notOffice()) return NOT_ALLOWED;
  const vendor = (formData.get("vendor") as string)?.trim();
  const po_number = (formData.get("po_number") as string)?.trim() || null;
  const job_id = (formData.get("job_id") as string) || null;
  const notes = (formData.get("notes") as string)?.trim() || null;
  const description = (formData.get("description") as string)?.trim() || "";
  const qty = Number(formData.get("qty")) || 0;
  const unit_cost = Number(formData.get("unit_cost")) || 0;

  if (!vendor) return { error: "Vendor is required." };

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

  if (error) {
    console.error("createPurchaseOrder failed", error.message);
    return { error: "Couldn't save the purchase order. Try again." };
  }

  revalidatePath("/procurement");
  return {};
}

/** Change a PO's status. Returns { error } (never throws) so the list can put the select back. */
export async function updatePoStatus(formData: FormData): Promise<{ error?: string }> {
  if (await notOffice()) return NOT_ALLOWED;
  const id = formData.get("id") as string;
  const status = formData.get("status") as string;
  if (!id || !status) return { error: "Missing purchase order or status. Refresh and try again." };

  const { data: existing, error: fetchError } = await supabase
    .from("purchase_orders")
    .select("ordered_at, received_at, delivered_at")
    .eq("id", id)
    .single();
  if (fetchError || !existing) return { error: "Couldn't find that purchase order. Refresh and try again." };

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

  if (error) {
    console.error("updatePoStatus failed", error.message);
    return { error: "Couldn't change the status. Try again." };
  }

  revalidatePath("/procurement");
  return {};
}

export async function deletePurchaseOrder(id: string): Promise<{ error?: string }> {
  if (await notOffice()) return NOT_ALLOWED;
  const { error } = await supabase.from("purchase_orders").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/procurement");
  return {};
}
