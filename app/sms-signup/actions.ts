"use server";

import { redirect } from "next/navigation";
import { findCustomerByPhone } from "@/lib/receptionist/customer-lookup";
import { resolveCustomerPropertyEquipment } from "@/lib/customer-intake";
import { supabase } from "@/lib/supabase";

export async function signUpForSms(formData: FormData) {
  const name = (formData.get("name") as string)?.trim() || null;
  const phone = (formData.get("phone") as string)?.trim();
  const consent = formData.get("consent") === "on";

  if (!phone) throw new Error("Phone number is required");
  if (!consent) throw new Error("Please check the box to agree to receive text messages");

  const existing = await findCustomerByPhone(phone);

  if (existing) {
    const { error } = await supabase
      .from("customers")
      .update({ sms_consent: true, sms_consent_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
  } else {
    await resolveCustomerPropertyEquipment({
      customerName: name ?? "Unknown (SMS Signup)",
      phone,
      smsConsent: true,
    });
  }

  redirect("/sms-signup?success=1");
}
