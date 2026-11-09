"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { resolveCustomerPropertyEquipment } from "@/lib/customer-intake";
import { createWarrantyForCustomer, type WarrantyEquipmentInput } from "@/lib/warranty-creation";
import { NEW_CUSTOMER_VALUE, NEW_PROPERTY_VALUE } from "../../../intake-constants";
import { requireOffice } from "@/lib/require-role";
import { reusableEquipmentId } from "@/lib/reuse-equipment";

/**
 * customerId / propertyId / equipmentIds (by row index) come back when new records
 * were saved but a later step failed, so the form reuses them and a retry does not
 * create a second copy.
 */
export type WarrantyFormState = {
  error?: string;
  customerId?: string;
  propertyId?: string;
  equipmentIds?: (string | null)[];
} | null;

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** New warranty record. Returns { error } for expected problems (the form keeps what was typed); redirects on success. */
export async function submitWarranty(_prev: WarrantyFormState, formData: FormData): Promise<WarrantyFormState> {
  try {
    await requireOffice();
  } catch {
    return { error: "Only the office or owner can create warranty records." };
  }
  let customer_id = formData.get("customer_id") as string;
  let property_id = formData.get("property_id") as string;
  const rowCount = Number(formData.get("row_count") ?? 0);
  const technician_name = (formData.get("technician_name") as string)?.trim() || null;
  const newCustomerName = (formData.get("new_customer_name") as string)?.trim();
  const newAddress = (formData.get("new_property_address") as string)?.trim();

  if (!customer_id) return { error: "Pick a customer." };
  if (!property_id) return { error: "Pick a property." };
  if (rowCount === 0) return { error: "Add at least one piece of equipment." };
  if (customer_id === NEW_CUSTOMER_VALUE && !newCustomerName) return { error: "Type the new customer's name." };
  if (property_id === NEW_PROPERTY_VALUE && !newAddress) return { error: "Type the new property's address." };

  const equipment: WarrantyEquipmentInput[] = [];
  for (let i = 0; i < rowCount; i++) {
    const equipmentId = (formData.get(`equipment_id_${i}`) as string) || null;
    const newEquipmentType = (formData.get(`new_equipment_type_${i}`) as string) || null;
    // Same rule as createWarrantyForCustomer, checked here so nothing is saved first.
    if (!equipmentId && !newEquipmentType?.trim()) {
      return { error: `Equipment ${i + 1}: pick existing equipment or type what it is.` };
    }
    equipment.push({
      equipmentId,
      newEquipmentType,
      newEquipmentBrand: (formData.get(`new_equipment_brand_${i}`) as string) || null,
      model: (formData.get(`model_${i}`) as string) || null,
      serialNumber: (formData.get(`serial_number_${i}`) as string) || null,
      installDate: (formData.get(`install_date_${i}`) as string) || null,
      docketNumber: (formData.get(`docket_number_${i}`) as string) || null,
      manufacturerYears: formData.get(`manufacturer_years_${i}`)
        ? Number(formData.get(`manufacturer_years_${i}`))
        : null,
      registered: formData.get(`registered_${i}`) === "on",
      registrationDate: (formData.get(`registration_date_${i}`) as string) || null,
    });
  }

  const createdCustomer = customer_id === NEW_CUSTOMER_VALUE;
  const createdProperty = property_id === NEW_PROPERTY_VALUE;
  // What to hand back if a later step fails: the records already saved.
  const saved = (): WarrantyFormState => {
    revalidatePath("/customers");
    revalidatePath("/properties");
    revalidatePath("/equipment");
    revalidatePath("/documents/warranty/new");
    return {
      ...(createdCustomer && customer_id !== NEW_CUSTOMER_VALUE ? { customerId: customer_id } : {}),
      ...(createdProperty && property_id !== NEW_PROPERTY_VALUE ? { propertyId: property_id } : {}),
      ...(createdEquipment.some(Boolean) ? { equipmentIds: createdEquipment } : {}),
    };
  };
  const savedNote = () =>
    (createdCustomer || createdProperty ? " The new customer/property was saved and is picked below." : "") +
    (createdEquipment.some(Boolean) ? " Equipment already saved will be reused, not added twice." : "");
  // New equipment saved so far, by row index, handed back on failure so a retry reuses it.
  const createdEquipment: (string | null)[] = equipment.map(() => null);

  if (createdCustomer) {
    try {
      const resolved = await resolveCustomerPropertyEquipment({
        customerName: newCustomerName,
        phone: (formData.get("new_customer_phone") as string)?.trim() || null,
        email: (formData.get("new_customer_email") as string)?.trim() || null,
        smsConsent: formData.get("new_customer_sms_consent") === "on",
      });
      customer_id = resolved.customerId!;
    } catch (err) {
      console.error("submitWarranty: new customer failed", errText(err));
      return { error: "Couldn't save the new customer. Nothing was created, try again." };
    }
  }

  if (createdProperty) {
    try {
      const resolved = await resolveCustomerPropertyEquipment({ customerId: customer_id, address: newAddress });
      property_id = resolved.propertyId!;
    } catch (err) {
      console.error("submitWarranty: new property failed", errText(err));
      return { ...saved(), error: `Couldn't save the new property. Try again.${savedNote()}` };
    }
  }

  // Save new equipment here (not inside createWarrantyForCustomer) so a later failure
  // can hand the ids back and a retry reuses them instead of adding duplicates.
  for (let i = 0; i < equipment.length; i++) {
    const row = equipment[i];
    if (row.equipmentId) continue;
    try {
      let id = await reusableEquipmentId(formData.get(`created_equipment_id_${i}`), property_id);
      if (!id) {
        const resolved = await resolveCustomerPropertyEquipment({
          customerId: customer_id,
          propertyId: property_id,
          equipment: {
            type: row.newEquipmentType!.trim(),
            brand: row.newEquipmentBrand?.trim() || null,
            model: row.model?.trim() || null,
          },
        });
        id = resolved.equipmentId;
      }
      row.equipmentId = id;
      createdEquipment[i] = id;
    } catch (err) {
      console.error("submitWarranty: new equipment failed", errText(err));
      return { ...saved(), error: `Couldn't save equipment ${i + 1}. Try again.${savedNote()}` };
    }
  }

  let documentId: string;
  try {
    ({ documentId } = await createWarrantyForCustomer({
      customerId: customer_id,
      propertyId: property_id,
      technicianName: technician_name,
      equipment,
    }));
  } catch (err) {
    console.error("submitWarranty: create failed", errText(err));
    return { ...saved(), error: `Couldn't save the warranty record. Your entries are below, try again.${savedNote()}` };
  }

  revalidatePath("/documents");
  revalidatePath("/equipment");
  revalidatePath("/customers");
  revalidatePath("/properties");
  redirect(`/documents/${documentId}`);
}
