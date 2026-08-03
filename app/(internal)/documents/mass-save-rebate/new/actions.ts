"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { resolveCustomerPropertyEquipment } from "@/lib/customer-intake";
import { extractFromImage } from "@/lib/vision-extract";
import { NEW_CUSTOMER_VALUE, NEW_PROPERTY_VALUE } from "../../../intake-constants";

const LabelSchema = z.object({
  brand: z.string().nullable(),
  model: z.string().nullable(),
  serial_number: z.string().nullable(),
  ahri_reference: z.string().nullable(),
  cooling_capacity_btu: z.number().nullable(),
});

export type ScannedEquipmentLabel = z.infer<typeof LabelSchema>;

export async function scanEquipmentLabel(formData: FormData): Promise<ScannedEquipmentLabel> {
  const photo = formData.get("photo") as File;
  if (!photo || photo.size === 0) throw new Error("No photo provided");

  return extractFromImage(
    photo,
    LabelSchema,
    `You are reading a photo of an HVAC heat pump nameplate, rating plate, or AHRI certificate label. Extract:
- brand: manufacturer name
- model: model number (outdoor or indoor unit)
- serial_number: serial number
- ahri_reference: the AHRI Certified Reference Number if shown (a numeric code, sometimes labeled "AHRI Certified Ref" or "AHRI #")
- cooling_capacity_btu: the rated cooling capacity in BTUs if shown (as a number, e.g. 24000)

Only extract what is legibly printed. Leave any field null if it isn't shown or isn't readable.`
  );
}

function firstOrNull(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function submitMassSaveRebate(formData: FormData) {
  let customer_id = formData.get("customer_id") as string;
  let property_id = formData.get("property_id") as string;
  const rowCount = Number(formData.get("equipment_row_count") ?? 0);

  if (!customer_id) throw new Error("Customer is required");
  if (!property_id) throw new Error("Property is required");

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

  const equipment: {
    equipment_id: string | null;
    label: string;
    install_date: string | null;
    ahri_reference: string | null;
    cooling_capacity_btu: string | null;
    tons: string | null;
    area_served: string | null;
  }[] = [];

  for (let i = 0; i < rowCount; i++) {
    const equipment_id = firstOrNull(formData, `equipment_id_${i}`);
    let label = "Equipment";
    if (equipment_id) {
      const { data } = await supabase
        .from("equipment")
        .select("type, brand, model")
        .eq("id", equipment_id)
        .single();
      if (data) label = [data.type, data.brand, data.model].filter(Boolean).join(" ");
    }

    equipment.push({
      equipment_id,
      label,
      install_date: firstOrNull(formData, `eq_install_date_${i}`),
      ahri_reference: firstOrNull(formData, `eq_ahri_${i}`),
      cooling_capacity_btu: firstOrNull(formData, `eq_btu_${i}`),
      tons: firstOrNull(formData, `eq_tons_${i}`),
      area_served: firstOrNull(formData, `eq_area_${i}`),
    });
  }

  const rebate_types = formData.getAll("rebate_types") as string[];

  const lineItems = {
    sponsor: {
      electric: firstOrNull(formData, "electric_sponsor"),
      electric_account_number: firstOrNull(formData, "electric_account_number"),
      gas: firstOrNull(formData, "gas_sponsor"),
      gas_account_number: firstOrNull(formData, "gas_account_number"),
    },
    project: {
      occupancy: firstOrNull(formData, "occupancy"),
      assessment_site_id: firstOrNull(formData, "assessment_site_id"),
      housing_type: firstOrNull(formData, "housing_type"),
      total_square_footage: firstOrNull(formData, "total_square_footage"),
      multi_unit_count: firstOrNull(formData, "multi_unit_count"),
      pre_existing_heating: firstOrNull(formData, "pre_existing_heating"),
      rebate_types,
    },
    integrated_control: {
      model: firstOrNull(formData, "ic_model"),
      switchover_temp: firstOrNull(formData, "ic_switchover_temp"),
      count: firstOrNull(formData, "ic_count"),
      location: firstOrNull(formData, "ic_location"),
    },
    installer: {
      company_name: firstOrNull(formData, "installer_company_name") ?? "East Coast Mechanical",
      hpin_company_id: firstOrNull(formData, "installer_hpin_id"),
      contact_person: firstOrNull(formData, "installer_contact_person"),
      phone: firstOrNull(formData, "installer_phone"),
      email: firstOrNull(formData, "installer_email"),
      address: firstOrNull(formData, "installer_address"),
      city: firstOrNull(formData, "installer_city"),
      state: firstOrNull(formData, "installer_state"),
      zip: firstOrNull(formData, "installer_zip"),
    },
    payee: firstOrNull(formData, "payee"),
    equipment,
  };

  const { data: document, error } = await supabase
    .from("documents")
    .insert({
      doc_number: null,
      type: "mass_save_rebate",
      customer_id,
      property_id,
      status: "draft",
      ai_generated: false,
      line_items: lineItems,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  revalidatePath("/documents");
  revalidatePath("/mass-save");
  redirect(`/documents/${document.id}`);
}
