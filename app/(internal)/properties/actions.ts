"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { resolveCustomerPropertyEquipment } from "@/lib/customer-intake";
import { idsWhere, cascadeUnlinkEquipment, cascadeUnlinkJobs, cascadeUnlinkDocuments } from "@/lib/cascade-delete";
import { NEW_CUSTOMER_VALUE } from "../intake-constants";

export async function addProperty(formData: FormData) {
  let customer_id = formData.get("customer_id") as string;
  const address = (formData.get("address") as string)?.trim();
  const property_type = formData.get("property_type") as string;

  if (!customer_id) {
    throw new Error("Customer is required");
  }
  if (!address) {
    throw new Error("Address is required");
  }

  if (customer_id === NEW_CUSTOMER_VALUE) {
    const newCustomerName = (formData.get("new_customer_name") as string)?.trim();
    if (!newCustomerName) throw new Error("New customer name is required");
    const resolved = await resolveCustomerPropertyEquipment({
      customerName: newCustomerName,
      phone: (formData.get("new_customer_phone") as string)?.trim() || null,
      email: (formData.get("new_customer_email") as string)?.trim() || null,
      smsConsent: formData.get("new_customer_sms_consent") === "on",
    });
    customer_id = resolved.customerId!;
  }

  const { error } = await supabase.from("properties").insert({
    customer_id,
    address,
    property_type: property_type || null,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/properties");
  revalidatePath("/customers");
}

export async function updateProperty(formData: FormData) {
  const id = formData.get("id") as string;
  const customer_id = formData.get("customer_id") as string;
  const address = (formData.get("address") as string)?.trim();
  const property_type = formData.get("property_type") as string;

  if (!id) throw new Error("Missing property id");
  if (!customer_id) throw new Error("Customer is required");
  if (!address) throw new Error("Address is required");

  const { error } = await supabase
    .from("properties")
    .update({
      customer_id,
      address,
      property_type: property_type || null,
    })
    .eq("id", id);

  if (error) throw new Error(error.message);

  revalidatePath("/properties");
  revalidatePath("/customers");
}

// Deletes a property and everything hanging off it — equipment, jobs,
// documents, and service contracts — mirroring deleteCustomer's cascade.
export async function deleteProperty(id: string): Promise<{ error?: string }> {
  const jobIds = await idsWhere("jobs", "property_id", id);
  const equipmentIds = await idsWhere("equipment", "property_id", id);

  await cascadeUnlinkEquipment(equipmentIds);
  await cascadeUnlinkJobs(jobIds);

  if (equipmentIds.length) await supabase.from("equipment").delete().in("id", equipmentIds);
  if (jobIds.length) await supabase.from("jobs").delete().in("id", jobIds);

  const documentIds = await idsWhere("documents", "property_id", id);
  await cascadeUnlinkDocuments(documentIds);
  if (documentIds.length) await supabase.from("documents").delete().in("id", documentIds);

  await supabase.from("service_contracts").delete().eq("property_id", id);

  const { error } = await supabase.from("properties").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/properties");
  revalidatePath("/customers");
  revalidatePath("/equipment");
  revalidatePath("/documents");
  revalidatePath("/jobs");
  return {};
}
