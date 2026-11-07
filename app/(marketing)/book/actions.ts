"use server";

import { redirect } from "next/navigation";
import { resolveCustomerPropertyEquipment } from "@/lib/customer-intake";
import { supabase } from "@/lib/supabase";
import { notifyOwnerOfWebLead } from "@/lib/notify-owner";
import { etDateAtHour, etDateKey } from "@/lib/tz";
import { COMPANY_PHONE_DISPLAY } from "@/lib/brand";

const WINDOW_HOURS: Record<string, number> = {
  morning: 8,
  afternoon: 12,
  evening: 16,
};

export type BookState = { error?: string } | null;

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();

/**
 * Website booking form. Returns { error } for anything the customer can fix, so
 * the form stays filled in, instead of throwing (a thrown error shows a blank
 * "something went wrong" page and loses what they typed).
 */
export async function bookService(_prev: BookState, formData: FormData): Promise<BookState> {
  // Hidden field people never see. Bots fill every box; pretend it worked.
  if (text(formData, "company_website")) redirect("/book?success=1");

  const name = text(formData, "name");
  const phone = text(formData, "phone");
  const email = text(formData, "email") || null;
  const address = text(formData, "address");
  const serviceType = text(formData, "service_type");
  const date = text(formData, "date");
  const window = text(formData, "window");
  const notes = text(formData, "notes");
  const smsConsent = formData.get("sms_consent") === "on";

  if (!name) return { error: "Please enter your name." };
  if (phone.replace(/\D/g, "").length < 10) return { error: "Please enter a phone number we can reach you at." };
  if (!address) return { error: "Please enter the service address." };
  if (!serviceType) return { error: "Please pick a service type." };
  // The window is New York time; the server clock is UTC.
  const scheduledAt = date ? etDateAtHour(date, WINDOW_HOURS[window] ?? 8) : null;
  if (!scheduledAt) return { error: "Please pick a preferred date." };
  if (date < etDateKey()) return { error: "That date has passed. Please pick today or a later day." };

  const description = notes ? `${serviceType} — ${notes}` : serviceType;
  const sorry = `Sorry, we couldn't save your request. Please try again, or call us at ${COMPANY_PHONE_DISPLAY}.`;

  try {
    const { customerId, propertyId } = await resolveCustomerPropertyEquipment({
      customerName: name,
      phone,
      email,
      smsConsent,
      address,
    });

    const { error } = await supabase.from("jobs").insert({
      customer_id: customerId,
      property_id: propertyId,
      scheduled_at: scheduledAt.toISOString(),
      status: "requested",
      created_via: "web_form",
      notes: description,
    });
    if (error) {
      console.error("bookService: job insert failed", error.message);
      return { error: sorry };
    }
  } catch (err) {
    console.error("bookService failed", err instanceof Error ? err.message : err);
    return { error: sorry };
  }

  // The request is saved; a failed owner email shouldn't make the customer retry.
  try {
    await notifyOwnerOfWebLead({
      source: "web_form",
      customerName: name,
      phone,
      address,
      description,
      scheduledAt,
    });
  } catch (err) {
    console.error("bookService: owner alert failed", err instanceof Error ? err.message : err);
  }

  redirect("/book?success=1");
}
