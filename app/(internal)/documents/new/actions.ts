"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { generateDocumentForCustomer } from "@/lib/document-generation";
import { resolveCustomerPropertyEquipment } from "@/lib/customer-intake";
import { NEW_CUSTOMER_VALUE } from "../../intake-constants";
import { requireOffice } from "@/lib/require-role";

/** customerId comes back when a new customer was saved but the document failed, so a retry reuses them. */
export type GenerateDocumentState = { error?: string; customerId?: string } | null;

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

const DOC_TYPES = ["estimate", "invoice", "proposal"] as const;

/** AI estimate/invoice/proposal. Returns { error } for expected problems (the form keeps what was typed); redirects on success. */
export async function generateDocument(_prev: GenerateDocumentState, formData: FormData): Promise<GenerateDocumentState> {
  try {
    await requireOffice();
  } catch {
    return { error: "Only the office or owner can create documents." };
  }
  let customer_id = formData.get("customer_id") as string;
  const property_id = (formData.get("property_id") as string) || null;
  const type = formData.get("type") as (typeof DOC_TYPES)[number];
  const pricing_mode = (formData.get("pricing_mode") as "tiered" | "flat") || "tiered";
  const raw_request = (formData.get("raw_request") as string)?.trim();
  const photos = formData.getAll("photos") as File[];
  const newCustomerName = (formData.get("new_customer_name") as string)?.trim();

  if (!customer_id) return { error: "Pick a customer." };
  if (!DOC_TYPES.includes(type)) return { error: "Pick a document type." };
  if (!raw_request) return { error: "Describe the job before generating." };

  // Save a new customer first, on its own, so a Claude failure below can hand the
  // customer back to the form instead of a retry making a second copy.
  const isNewCustomer = customer_id === NEW_CUSTOMER_VALUE;
  if (isNewCustomer) {
    if (!newCustomerName) return { error: "Type the new customer's name." };
    try {
      const resolved = await resolveCustomerPropertyEquipment({
        customerName: newCustomerName,
        phone: (formData.get("new_customer_phone") as string)?.trim() || null,
        email: (formData.get("new_customer_email") as string)?.trim() || null,
        smsConsent: formData.get("new_customer_sms_consent") === "on",
      });
      customer_id = resolved.customerId!;
    } catch (err) {
      console.error("generateDocument: new customer failed", errText(err));
      return { error: "Couldn't save the new customer. Nothing was created, try again." };
    }
  }

  let results: Awaited<ReturnType<typeof generateDocumentForCustomer>>;
  try {
    results = await generateDocumentForCustomer({
      customerId: customer_id,
      propertyId: property_id,
      type,
      rawRequest: raw_request,
      photos,
      pricingMode: pricing_mode,
    });
  } catch (err) {
    console.error("generateDocument: generation failed", errText(err));
    if (isNewCustomer) {
      revalidatePath("/customers");
      revalidatePath("/documents/new");
      return {
        customerId: customer_id,
        error:
          "Couldn't generate the document. The new customer was saved and is picked below. Your description is still here, try again.",
      };
    }
    return { error: "Couldn't generate the document. Your description is still here, try again." };
  }
  if (!results.length) return { error: "Couldn't generate the document. Your description is still here, try again." };

  revalidatePath("/documents");
  revalidatePath("/customers");
  // If the request described multiple mutually-exclusive options, this
  // creates one document per option — land on the first, the rest are
  // visible in the main /documents list under their own doc numbers.
  redirect(`/documents/${results[0].documentId}`);
}
