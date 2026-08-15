"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { resolveCustomerPropertyEquipment } from "@/lib/customer-intake";
import { createContract } from "@/lib/contract-creation";
import { NEW_CUSTOMER_VALUE, NEW_PROPERTY_VALUE } from "../../../intake-constants";

export async function submitContract(formData: FormData) {
  let customer_id = formData.get("customer_id") as string;
  let property_id = formData.get("property_id") as string;
  const price = Number(formData.get("price"));
  const scope_of_work = (formData.get("scope_of_work") as string)?.trim();
  const payment_terms = (formData.get("payment_terms") as string)?.trim() || null;
  const warranty_terms = (formData.get("warranty_terms") as string)?.trim() || null;
  const start_date = (formData.get("start_date") as string) || null;
  const estimated_completion = (formData.get("estimated_completion") as string) || null;
  const notes = (formData.get("notes") as string)?.trim() || null;
  const from_document_id = (formData.get("from_document_id") as string) || null;

  if (!customer_id) throw new Error("Customer is required");
  if (!property_id) throw new Error("Property is required");
  if (!scope_of_work) throw new Error("Scope of work is required");
  if (!(price > 0)) throw new Error("Contract price must be greater than zero");

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

  if (property_id === NEW_PROPERTY_VALUE) {
    const newAddress = (formData.get("new_property_address") as string)?.trim();
    if (!newAddress) throw new Error("New property address is required");
    const resolved = await resolveCustomerPropertyEquipment({
      customerId: customer_id,
      address: newAddress,
    });
    property_id = resolved.propertyId!;
  }

  const { documentId } = await createContract({
    customerId: customer_id,
    propertyId: property_id,
    price,
    scopeOfWork: scope_of_work,
    paymentTerms: payment_terms,
    warrantyTerms: warranty_terms,
    startDate: start_date,
    estimatedCompletion: estimated_completion,
    notes,
    fromDocumentId: from_document_id,
  });

  revalidatePath("/documents");
  revalidatePath("/customers");
  revalidatePath("/properties");
  redirect(`/documents/${documentId}`);
}
