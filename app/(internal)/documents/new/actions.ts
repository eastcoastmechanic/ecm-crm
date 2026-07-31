"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { generateDocumentForCustomer } from "@/lib/document-generation";
import { NEW_CUSTOMER_VALUE } from "../../intake-constants";

export async function generateDocument(formData: FormData) {
  const customer_id = formData.get("customer_id") as string;
  const property_id = (formData.get("property_id") as string) || null;
  const type = formData.get("type") as "estimate" | "invoice" | "proposal";
  const raw_request = (formData.get("raw_request") as string)?.trim();

  if (!customer_id) throw new Error("Customer is required");

  const isNewCustomer = customer_id === NEW_CUSTOMER_VALUE;

  const results = await generateDocumentForCustomer({
    customerId: isNewCustomer ? null : customer_id,
    customerName: isNewCustomer ? (formData.get("new_customer_name") as string)?.trim() : null,
    phone: isNewCustomer ? (formData.get("new_customer_phone") as string)?.trim() || null : null,
    email: isNewCustomer ? (formData.get("new_customer_email") as string)?.trim() || null : null,
    smsConsent: isNewCustomer ? formData.get("new_customer_sms_consent") === "on" : undefined,
    propertyId: property_id,
    type,
    rawRequest: raw_request,
  });

  revalidatePath("/documents");
  revalidatePath("/customers");
  // If the request described multiple mutually-exclusive options, this
  // creates one document per option — land on the first, the rest are
  // visible in the main /documents list under their own doc numbers.
  redirect(`/documents/${results[0].documentId}`);
}
