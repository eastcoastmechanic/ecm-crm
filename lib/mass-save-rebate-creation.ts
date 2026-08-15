import { supabase } from "@/lib/supabase";
import { syncDocumentToGraph } from "@/lib/graph-connector";

export type MassSaveEquipmentInput = {
  equipmentId?: string | null;
  installDate?: string | null;
  ahriReference?: string | null;
  coolingCapacityBtu?: string | null;
  tons?: string | null;
  areaServed?: string | null;
};

export type CreateMassSaveRebateInput = {
  customerId: string;
  propertyId: string;
  equipment?: MassSaveEquipmentInput[];
  sponsor?: {
    electric?: string | null;
    electricAccountNumber?: string | null;
    gas?: string | null;
    gasAccountNumber?: string | null;
  };
  project?: {
    occupancy?: string | null;
    assessmentSiteId?: string | null;
    housingType?: string | null;
    totalSquareFootage?: string | null;
    multiUnitCount?: string | null;
    preExistingHeating?: string | null;
    rebateTypes?: string[];
  };
  integratedControl?: {
    model?: string | null;
    switchoverTemp?: string | null;
    count?: string | null;
    location?: string | null;
  };
  installer?: {
    companyName?: string | null;
    hpinCompanyId?: string | null;
    contactPerson?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
  };
  payee?: string | null;
};

/**
 * Core of Mass Save rebate document creation. Almost every field on the
 * real form is optional here (matching the human form, which leaves fields
 * as null until filled) — this creates a draft the office can finish in the
 * app; it's not expected to produce a submission-ready document from chat
 * alone. Shared by the documents/mass-save-rebate/new form action and the
 * internal AI assistant's create_mass_save_rebate tool.
 */
export async function createMassSaveRebateForCustomer(
  input: CreateMassSaveRebateInput
): Promise<{ documentId: string }> {
  const { customerId, propertyId } = input;
  if (!customerId) throw new Error("Customer is required");
  if (!propertyId) throw new Error("Property is required");

  const equipment = [];
  for (const row of input.equipment ?? []) {
    let label = "Equipment";
    if (row.equipmentId) {
      const { data } = await supabase
        .from("equipment")
        .select("type, brand, model")
        .eq("id", row.equipmentId)
        .single();
      if (data) label = [data.type, data.brand, data.model].filter(Boolean).join(" ");
    }
    equipment.push({
      equipment_id: row.equipmentId ?? null,
      label,
      install_date: row.installDate ?? null,
      ahri_reference: row.ahriReference ?? null,
      cooling_capacity_btu: row.coolingCapacityBtu ?? null,
      tons: row.tons ?? null,
      area_served: row.areaServed ?? null,
    });
  }

  const lineItems = {
    sponsor: {
      electric: input.sponsor?.electric ?? null,
      electric_account_number: input.sponsor?.electricAccountNumber ?? null,
      gas: input.sponsor?.gas ?? null,
      gas_account_number: input.sponsor?.gasAccountNumber ?? null,
    },
    project: {
      occupancy: input.project?.occupancy ?? null,
      assessment_site_id: input.project?.assessmentSiteId ?? null,
      housing_type: input.project?.housingType ?? null,
      total_square_footage: input.project?.totalSquareFootage ?? null,
      multi_unit_count: input.project?.multiUnitCount ?? null,
      pre_existing_heating: input.project?.preExistingHeating ?? null,
      rebate_types: input.project?.rebateTypes ?? [],
    },
    integrated_control: {
      model: input.integratedControl?.model ?? null,
      switchover_temp: input.integratedControl?.switchoverTemp ?? null,
      count: input.integratedControl?.count ?? null,
      location: input.integratedControl?.location ?? null,
    },
    installer: {
      company_name: input.installer?.companyName ?? "East Coast Mechanical",
      hpin_company_id: input.installer?.hpinCompanyId ?? null,
      contact_person: input.installer?.contactPerson ?? null,
      phone: input.installer?.phone ?? null,
      email: input.installer?.email ?? null,
      address: input.installer?.address ?? null,
      city: input.installer?.city ?? null,
      state: input.installer?.state ?? null,
      zip: input.installer?.zip ?? null,
    },
    payee: input.payee ?? null,
    equipment,
  };

  const { data: document, error } = await supabase
    .from("documents")
    .insert({
      doc_number: null,
      type: "mass_save_rebate",
      customer_id: customerId,
      property_id: propertyId,
      status: "draft",
      ai_generated: false,
      line_items: lineItems,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  await syncDocumentToGraph(document.id);

  return { documentId: document.id };
}
