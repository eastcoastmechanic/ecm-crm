"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";

export async function addCustomer(formData: FormData) {
  const name = (formData.get("name") as string)?.trim();
  const email = (formData.get("email") as string)?.trim();
  const phone = (formData.get("phone") as string)?.trim();
  const billing_address = (formData.get("billing_address") as string)?.trim();
  const notes = (formData.get("notes") as string)?.trim();
  const sms_consent = formData.get("sms_consent") === "on";
  const referred_by_customer_id = (formData.get("referred_by_customer_id") as string)?.trim();

  if (!name) {
    throw new Error("Name is required");
  }

  const { error } = await supabase.from("customers").insert({
    name,
    email: email || null,
    phone: phone || null,
    billing_address: billing_address || null,
    notes: notes || null,
    sms_consent,
    sms_consent_at: sms_consent ? new Date().toISOString() : null,
    referred_by_customer_id: referred_by_customer_id || null,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/customers");
}

const RELATED_TABLES: { table: string; singular: string; plural: string }[] = [
  { table: "properties", singular: "property", plural: "properties" },
  { table: "documents", singular: "document", plural: "documents" },
  { table: "jobs", singular: "job", plural: "jobs" },
  { table: "service_contracts", singular: "service contract", plural: "service contracts" },
  { table: "ai_conversations", singular: "conversation", plural: "conversations" },
  { table: "leads", singular: "lead", plural: "leads" },
];

export async function deleteCustomer(id: string): Promise<{ error?: string }> {
  const blockers: string[] = [];

  for (const { table, singular, plural } of RELATED_TABLES) {
    const { count } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("customer_id", id);
    if (count && count > 0) {
      blockers.push(`${count} ${count === 1 ? singular : plural}`);
    }
  }

  if (blockers.length > 0) {
    return {
      error: `Can't delete — this customer still has ${blockers.join(", ")}. Remove those first.`,
    };
  }

  const { error } = await supabase.from("customers").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/customers");
  return {};
}
