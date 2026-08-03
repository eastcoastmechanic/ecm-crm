"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { resolveCustomerPropertyEquipment } from "@/lib/customer-intake";
import { NEW_CUSTOMER_VALUE, NEW_PROPERTY_VALUE } from "../../../intake-constants";

const CRAFTSMANSHIP_WARRANTY_YEARS = 1;

async function nextWarrantyNumber() {
  const { count } = await supabase
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("type", "warranty");
  return `WTY-${1001 + (count ?? 0)}`;
}

function addYears(dateStr: string, years: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

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

  const items: {
    equipment_id: string | null;
    equipment_label: string;
    model: string | null;
    serial_number: string | null;
    install_date: string | null;
    manufacturer: {
      docket_number: string | null;
      years: number | null;
      registered: boolean;
      registration_date: string | null;
      expiration_date: string | null;
    };
    craftsmanship: {
      years: number;
      expiration_date: string | null;
    };
  }[] = [];

  for (let i = 0; i < rowCount; i++) {
    let equipment_id = (formData.get(`equipment_id_${i}`) as string) || null;
    const model = (formData.get(`model_${i}`) as string)?.trim() || null;
    const serial_number = (formData.get(`serial_number_${i}`) as string)?.trim() || null;
    const install_date = (formData.get(`install_date_${i}`) as string) || null;

    let equipmentLabel: string;

    if (!equipment_id) {
      const newType = (formData.get(`new_equipment_type_${i}`) as string)?.trim();
      const newBrand = (formData.get(`new_equipment_brand_${i}`) as string)?.trim() || null;
      if (!newType) throw new Error(`Equipment ${i + 1}: pick existing equipment or enter a type`);

      const resolved = await resolveCustomerPropertyEquipment({
        customerId: customer_id,
        propertyId: property_id,
        equipment: { type: newType, brand: newBrand, model },
      });
      equipment_id = resolved.equipmentId;
      equipmentLabel = [newType, newBrand, model].filter(Boolean).join(" ");
    } else {
      const { data: existing } = await supabase
        .from("equipment")
        .select("type, brand, model")
        .eq("id", equipment_id)
        .single();
      equipmentLabel = existing
        ? [existing.type, existing.brand, model ?? existing.model].filter(Boolean).join(" ")
        : "Equipment";
    }

    const docket_number = (formData.get(`docket_number_${i}`) as string)?.trim() || null;
    const manufacturer_years = formData.get(`manufacturer_years_${i}`)
      ? Number(formData.get(`manufacturer_years_${i}`))
      : null;
    const registered = formData.get(`registered_${i}`) === "on";
    const registration_date = (formData.get(`registration_date_${i}`) as string) || null;

    const manufacturer_expiration =
      install_date && manufacturer_years ? addYears(install_date, manufacturer_years) : null;
    const craftsmanship_expiration = install_date
      ? addYears(install_date, CRAFTSMANSHIP_WARRANTY_YEARS)
      : null;

    if (equipment_id) {
      const warranty_expiration =
        [manufacturer_expiration, craftsmanship_expiration]
          .filter((d): d is string => !!d)
          .sort()
          .pop() ?? null;

      await supabase
        .from("equipment")
        .update({
          ...(model ? { model } : {}),
          ...(serial_number ? { serial_number } : {}),
          ...(install_date ? { install_date } : {}),
          ...(warranty_expiration ? { warranty_expiration } : {}),
        })
        .eq("id", equipment_id);
    }

    items.push({
      equipment_id,
      equipment_label: equipmentLabel,
      model,
      serial_number,
      install_date,
      manufacturer: {
        docket_number,
        years: manufacturer_years,
        registered,
        registration_date,
        expiration_date: manufacturer_expiration,
      },
      craftsmanship: {
        years: CRAFTSMANSHIP_WARRANTY_YEARS,
        expiration_date: craftsmanship_expiration,
      },
    });
  }

  const doc_number = await nextWarrantyNumber();

  const { data: document, error } = await supabase
    .from("documents")
    .insert({
      doc_number,
      type: "warranty",
      customer_id,
      property_id,
      status: "active",
      ai_generated: false,
      line_items: { technician_name, items },
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  revalidatePath("/documents");
  revalidatePath("/equipment");
  revalidatePath("/customers");
  revalidatePath("/properties");
  redirect(`/documents/${document.id}`);
}
