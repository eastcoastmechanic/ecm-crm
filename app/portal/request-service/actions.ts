"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createPortalServerClient } from "@/lib/supabase-portal/server";
import { etDateAtHour } from "@/lib/tz";

const WINDOW_HOURS: Record<string, number> = {
  morning: 8,
  afternoon: 12,
  evening: 16,
};

export async function requestService(formData: FormData) {
  const supabase = await createPortalServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/portal/login");

  const { data: customer } = await supabase.from("customers").select("id").limit(1).maybeSingle();
  if (!customer) throw new Error("No customer account linked");

  const property_id = formData.get("property_id") as string;
  const date = formData.get("date") as string;
  const window = formData.get("window") as string;
  const notes = (formData.get("notes") as string)?.trim();

  if (!property_id) throw new Error("Property is required");
  if (!date) throw new Error("Preferred date is required");
  if (!notes) throw new Error("Describe what you need service for");

  // The window is New York time; the server clock is UTC.
  const scheduled_at = etDateAtHour(date, WINDOW_HOURS[window] ?? 8);
  if (!scheduled_at) throw new Error("Preferred date is required");

  const { error } = await supabase.from("jobs").insert({
    customer_id: customer.id,
    property_id,
    scheduled_at: scheduled_at.toISOString(),
    status: "requested",
    notes,
  });

  if (error) throw new Error(error.message);

  revalidatePath("/portal");
  redirect("/portal");
}
