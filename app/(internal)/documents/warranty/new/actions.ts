"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { resolveCustomerPropertyEquipment } from "@/lib/customer-intake";
import { createWarrantyForCustomer, type WarrantyEquipmentInput } from "@/lib/warranty-creation";
import { NEW_CUSTOMER_VALUE, NEW_PROPERTY_VALUE } from "../../../intake-constants";

export async function submitWarranty(formData: FormData) {
  let customer_id = formData.get("customer_id") as string;
  let property_id = formData.get("property_id") as string;
  const rowCount = Number(formData.get("row_count") ?? 0);
  const technician_name = (formData.get("technician_name") as string)?.trim() || null;

  if (!customer_id) throw new Error("Customer is required");
  if (!property_id) throw new Error("Property is required");
  if (rowCount === 0) throw new Error("Add at least one piece of equipment");

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

  const equipment: WarrantyEquipmentInput[] = [];
  for (let i = 0; i < rowCount; i++) {
    equipment.push({
      equipmentId: (formData.get(`equipment_id_${i}`) as string) || null,
      newEquipmentType: (formData.get(`new_equipment_type_${i}`) as string) || null,
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

  const { documentId } = await createWarrantyForCustomer({
    customerId: customer_id,
    propertyId: property_id,
    technicianName: technician_name,
    equipment,
  });

  revalidatePath("/documents");
  revalidatePath("/equipment");
  revalidatePath("/customers");
  revalidatePath("/properties");
  redirect(`/documents/${documentId}`);
}
