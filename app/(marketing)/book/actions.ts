"use server";

import { redirect } from "next/navigation";
import { resolveCustomerPropertyEquipment } from "@/lib/customer-intake";
import { supabase } from "@/lib/supabase";
import { notifyOwnerOfWebLead } from "@/lib/notify-owner";

const WINDOW_HOURS: Record<string, number> = {
  morning: 8,
  afternoon: 12,
  evening: 16,
};

export async function bookService(formData: FormData) {
  const name = (formData.get("name") as string)?.trim();
  const phone = (formData.get("phone") as string)?.trim();
  const email = (formData.get("email") as string)?.trim() || null;
  const address = (formData.get("address") as string)?.trim();
  const serviceType = (formData.get("service_type") as string)?.trim();
  const date = formData.get("date") as string;
  const window = formData.get("window") as string;
  const notes = (formData.get("notes") as string)?.trim();
  const smsConsent = formData.get("sms_consent") === "on";

  if (!name) throw new Error("Name is required");
  if (!phone) throw new Error("Phone number is required");
  if (!address) throw new Error("Service address is required");
  if (!serviceType) throw new Error("Please select a service type");
  if (!date) throw new Error("Preferred date is required");

  const description = notes ? `${serviceType} — ${notes}` : serviceType;

  const { customerId, propertyId } = await resolveCustomerPropertyEquipment({
    customerName: name,
    phone,
    email,
    smsConsent,
    address,
  });

  const hour = WINDOW_HOURS[window] ?? 8;
  const scheduledAt = new Date(`${date}T00:00:00`);
  scheduledAt.setHours(hour, 0, 0, 0);

  const { error } = await supabase.from("jobs").insert({
    customer_id: customerId,
    property_id: propertyId,
    scheduled_at: scheduledAt.toISOString(),
    status: "requested",
    created_via: "web_form",
    notes: description,
  });
  if (error) throw new Error(error.message);

  await notifyOwnerOfWebLead({
    source: "web_form",
    customerName: name,
    phone,
    address,
    description,
    scheduledAt,
  });

  redirect("/book?success=1");
}
