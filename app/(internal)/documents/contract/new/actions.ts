"use server";

import { redirect } from "next/navigation";
import { parseVisitMonths } from "@/lib/maintenance-visits";
import { revalidatePath } from "next/cache";
import { resolveCustomerPropertyEquipment } from "@/lib/customer-intake";
import { createContract } from "@/lib/contract-creation";
import { NEW_CUSTOMER_VALUE, NEW_PROPERTY_VALUE } from "../../../intake-constants";
import { requireOffice } from "@/lib/require-role";

/**
 * customerId / propertyId come back when a new customer or property was saved but a
 * later step failed, so the form switches its pickers to them and a retry does not
 * create a second copy.
 */
export type ContractFormState = { error?: string; customerId?: string; propertyId?: string } | null;

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** New contract. Returns { error } for expected problems (the form keeps what was typed); redirects on success. */
export async function submitContract(_prev: ContractFormState, formData: FormData): Promise<ContractFormState> {
  try {
    await requireOffice();
  } catch {
    return { error: "Only the office or owner can create contracts." };
  }
  let customer_id = formData.get("customer_id") as string;
  let property_id = formData.get("property_id") as string;
  const price = Number(formData.get("price"));
  const scope_of_work = (formData.get("scope_of_work") as string)?.trim();
  const payment_terms = (formData.get("payment_terms") as string)?.trim() || null;
  const warranty_terms = (formData.get("warranty_terms") as string)?.trim() || null;
  const start_date = (formData.get("start_date") as string) || null;
  const estimated_completion = (formData.get("estimated_completion") as string) || null;
  const notes = (formData.get("notes") as string)?.trim() || null;
  const auto_renew_price = Number(formData.get("auto_renew_price")) || null;
  // Blank means this plan has no scheduled visits ([]), which is different from "not set" (the default).
  const visit_months = parseVisitMonths(formData.get("visit_months") as string | null) ?? [];
  const from_document_id = (formData.get("from_document_id") as string) || null;
  const newCustomerName = (formData.get("new_customer_name") as string)?.trim();
  const newAddress = (formData.get("new_property_address") as string)?.trim();

  // Check every field before saving anything, so a bad field never leaves a half-made customer behind.
  if (!customer_id) return { error: "Pick a customer." };
  if (!property_id) return { error: "Pick a property." };
  if (!scope_of_work) return { error: "Scope of work is required." };
  if (!(price > 0)) return { error: "Contract price must be more than $0." };
  if (customer_id === NEW_CUSTOMER_VALUE && !newCustomerName) return { error: "Type the new customer's name." };
  if (property_id === NEW_PROPERTY_VALUE && !newAddress) return { error: "Type the new property's address." };

  const createdCustomer = customer_id === NEW_CUSTOMER_VALUE;
  const createdProperty = property_id === NEW_PROPERTY_VALUE;
  // What to hand back if a later step fails: the records already saved.
  const saved = (): ContractFormState => {
    revalidatePath("/customers");
    revalidatePath("/properties");
    revalidatePath("/documents/contract/new");
    return {
      ...(createdCustomer && customer_id !== NEW_CUSTOMER_VALUE ? { customerId: customer_id } : {}),
      ...(createdProperty && property_id !== NEW_PROPERTY_VALUE ? { propertyId: property_id } : {}),
    };
  };

  if (customer_id === NEW_CUSTOMER_VALUE) {
    try {
      const resolved = await resolveCustomerPropertyEquipment({
        customerName: newCustomerName,
        phone: (formData.get("new_customer_phone") as string)?.trim() || null,
        email: (formData.get("new_customer_email") as string)?.trim() || null,
        smsConsent: formData.get("new_customer_sms_consent") === "on",
      });
      customer_id = resolved.customerId!;
    } catch (err) {
      console.error("submitContract: new customer failed", errText(err));
      return { error: "Couldn't save the new customer. Nothing was created, try again." };
    }
  }

  if (property_id === NEW_PROPERTY_VALUE) {
    try {
      const resolved = await resolveCustomerPropertyEquipment({
        customerId: customer_id,
        address: newAddress,
      });
      property_id = resolved.propertyId!;
    } catch (err) {
      console.error("submitContract: new property failed", errText(err));
      return {
        ...saved(),
        error: createdCustomer
          ? "Saved the new customer, but couldn't save the new property. It's picked below, try again."
          : "Couldn't save the new property. Try again.",
      };
    }
  }

  let documentId: string;
  try {
    ({ documentId } = await createContract({
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
      autoRenewPrice: auto_renew_price,
      visitMonths: visit_months,
    }));
  } catch (err) {
    console.error("submitContract: create failed", errText(err));
    return {
      ...saved(),
      error:
        createdCustomer || createdProperty
          ? "Saved the new customer/property, but couldn't save the contract. They're picked below, try again."
          : "Couldn't save the contract. Your entries are still here, try again.",
    };
  }

  revalidatePath("/documents");
  revalidatePath("/customers");
  revalidatePath("/properties");
  redirect(`/documents/${documentId}`);
}
