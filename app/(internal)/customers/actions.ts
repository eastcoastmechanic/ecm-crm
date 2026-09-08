"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { idsWhere, idsWhereIn, unique, cascadeUnlinkEquipment, cascadeUnlinkJobs, cascadeUnlinkDocuments } from "@/lib/cascade-delete";
import { syncCustomerToGraph, deleteCustomerFromGraph, deleteJobFromGraph, deleteDocumentFromGraph } from "@/lib/graph-connector";

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

  const { data: customer, error } = await supabase
    .from("customers")
    .insert({
      name,
      email: email || null,
      phone: phone || null,
      billing_address: billing_address || null,
      notes: notes || null,
      sms_consent,
      sms_consent_at: sms_consent ? new Date().toISOString() : null,
      referred_by_customer_id: referred_by_customer_id || null,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  if (customer) await syncCustomerToGraph(customer.id);

  revalidatePath("/customers");
}

export async function updateCustomer(formData: FormData) {
  const id = formData.get("id") as string;
  const name = (formData.get("name") as string)?.trim();
  const email = (formData.get("email") as string)?.trim();
  const phone = (formData.get("phone") as string)?.trim();
  const billing_address = (formData.get("billing_address") as string)?.trim();
  const notes = (formData.get("notes") as string)?.trim();
  const sms_consent = formData.get("sms_consent") === "on";

  if (!id) throw new Error("Missing customer id");
  if (!name) throw new Error("Name is required");

  const { error } = await supabase
    .from("customers")
    .update({
      name,
      email: email || null,
      phone: phone || null,
      billing_address: billing_address || null,
      notes: notes || null,
      sms_consent,
    })
    .eq("id", id);

  if (error) throw new Error(error.message);

  await syncCustomerToGraph(id);

  revalidatePath(`/customers/${id}`);
  revalidatePath("/customers");
  // Documents render the customer's name/email and gate "Send to Customer" on
  // that email, and this form is reachable from a document's own header — so
  // without this the page you just edited from would keep showing the stale
  // value (and keep hiding the send button) until a hard reload.
  revalidatePath("/documents", "layout");
}

// Deletes a customer and everything hanging off it — properties, equipment,
// jobs, documents, diagnostics, satisfaction surveys, SMS history, service
// contracts, install reports, and AI conversation history. Traced from the
// live DB's actual foreign keys (not the schema.sql snapshot, which is stale
// for newer tables). Runs as a sequence of awaited deletes rather than a
// single SQL transaction, same style as the rest of this codebase (e.g.
// submitWarranty) — Supabase's REST client doesn't expose multi-statement
// transactions.
export async function deleteCustomer(id: string): Promise<{ error?: string }> {
  if (!id) return { error: "Missing customer id" };

  try {
    const propertyIds = await idsWhere("properties", "customer_id", id);

    const jobIds = unique([
      ...(await idsWhere("jobs", "customer_id", id)),
      ...(await idsWhereIn("jobs", "property_id", propertyIds)),
    ]);

    const equipmentIds = await idsWhereIn("equipment", "property_id", propertyIds);

    await cascadeUnlinkEquipment(equipmentIds);
    await cascadeUnlinkJobs(jobIds);

    const { error: smsError } = await supabase.from("sms_messages").delete().eq("customer_id", id);
    if (smsError) return { error: smsError.message };

    const { error: installByCustomerError } = await supabase.from("install_reports").delete().eq("customer_id", id);
    if (installByCustomerError) return { error: installByCustomerError.message };

    if (propertyIds.length) {
      const { error: installByPropertyError } = await supabase
        .from("install_reports")
        .delete()
        .in("property_id", propertyIds);
      if (installByPropertyError) return { error: installByPropertyError.message };
    }

    if (equipmentIds.length) {
      const { error: equipmentError } = await supabase.from("equipment").delete().in("id", equipmentIds);
      if (equipmentError) return { error: equipmentError.message };
    }
    if (jobIds.length) {
      const { error: jobError } = await supabase.from("jobs").delete().in("id", jobIds);
      if (jobError) return { error: jobError.message };
    }

    const documentIds = unique([
      ...(await idsWhere("documents", "customer_id", id)),
      ...(await idsWhereIn("documents", "property_id", propertyIds)),
    ]);
    await cascadeUnlinkDocuments(documentIds);
    if (documentIds.length) {
      const { error: documentError } = await supabase.from("documents").delete().in("id", documentIds);
      if (documentError) return { error: documentError.message };
    }

    await Promise.all([
      deleteCustomerFromGraph(id),
      ...jobIds.map(deleteJobFromGraph),
      ...documentIds.map(deleteDocumentFromGraph),
    ]);

    const { error: contractError } = await supabase.from("service_contracts").delete().eq("customer_id", id);
    if (contractError) return { error: contractError.message };
    if (propertyIds.length) {
      const { error: contractByPropertyError } = await supabase
        .from("service_contracts")
        .delete()
        .in("property_id", propertyIds);
      if (contractByPropertyError) return { error: contractByPropertyError.message };
    }

    if (propertyIds.length) {
      const { error: propertyError } = await supabase.from("properties").delete().in("id", propertyIds);
      if (propertyError) return { error: propertyError.message };
    }

    const { error: conversationError } = await supabase.from("ai_conversations").delete().eq("customer_id", id);
    if (conversationError) return { error: conversationError.message };

    // Unlink rather than delete — these reference this customer without belonging to them.
    const { error: leadError } = await supabase.from("leads").update({ customer_id: null }).eq("customer_id", id);
    if (leadError) return { error: leadError.message };
    const { error: referralError } = await supabase
      .from("customers")
      .update({ referred_by_customer_id: null })
      .eq("referred_by_customer_id", id);
    if (referralError) return { error: referralError.message };
    const { error: taskError } = await supabase.from("tasks").update({ customer_id: null }).eq("customer_id", id);
    if (taskError) return { error: taskError.message };

    const { error } = await supabase.from("customers").delete().eq("id", id);
    if (error) return { error: error.message };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not delete customer" };
  }

  revalidatePath("/customers");
  revalidatePath("/properties");
  revalidatePath("/equipment");
  revalidatePath("/documents");
  revalidatePath("/jobs");
  return {};
}
