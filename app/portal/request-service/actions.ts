"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createPortalServerClient } from "@/lib/supabase-portal/server";
import { etDateAtHour, etDateKey } from "@/lib/tz";

const WINDOW_HOURS: Record<string, number> = {
  morning: 8,
  afternoon: 12,
  evening: 16,
};

export type RequestState = { error?: string } | null;

/** Customer asks for service from the portal. Returns { error } so the form keeps what they typed. */
export async function requestService(_prev: RequestState, formData: FormData): Promise<RequestState> {
  const supabase = await createPortalServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/portal/login");

  const { data: customer } = await supabase.from("customers").select("id").limit(1).maybeSingle();
  if (!customer) return { error: "Your login isn't linked to a customer account yet. Please call us and we'll fix it." };

  const property_id = String(formData.get("property_id") ?? "");
  const date = String(formData.get("date") ?? "");
  const window = String(formData.get("window") ?? "");
  const notes = String(formData.get("notes") ?? "").trim();

  if (!property_id) return { error: "Please pick the property." };
  if (!notes) return { error: "Please tell us what you need service for." };
  // The window is New York time; the server clock is UTC.
  const scheduled_at = date ? etDateAtHour(date, WINDOW_HOURS[window] ?? 8) : null;
  if (!scheduled_at) return { error: "Please pick a preferred date." };
  if (date < etDateKey()) return { error: "That date has passed. Please pick today or a later day." };

  const { error } = await supabase.from("jobs").insert({
    customer_id: customer.id,
    property_id,
    scheduled_at: scheduled_at.toISOString(),
    status: "requested",
    notes,
  });

  if (error) {
    console.error("requestService: insert failed", error.message);
    return { error: "Couldn't send your request. Please try again, or call us." };
  }

  revalidatePath("/portal");
  redirect("/portal");
}
