import { supabase } from "@/lib/supabase";
import { resolveCustomerPropertyEquipment } from "@/lib/customer-intake";
import { syncDocumentToGraph } from "@/lib/graph-connector";

const CRAFTSMANSHIP_WARRANTY_YEARS = 1;

function addYears(dateStr: string, years: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

async function nextWarrantyNumber() {
  const { count } = await supabase
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("type", "warranty");
  return `WTY-${1001 + (count ?? 0)}`;
}

export type WarrantyEquipmentInput = {
  equipmentId?: string | null;
  newEquipmentType?: string | null;
  newEquipmentBrand?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  installDate?: string | null;
  docketNumber?: string | null;
  manufacturerYears?: number | null;
  registered?: boolean;
  registrationDate?: string | null;
};

export type CreateWarrantyInput = {
  customerId: string;
  propertyId: string;
  technicianName?: string | null;
  equipment: WarrantyEquipmentInput[];
};

/**
 * Core of warranty document creation: given a customer/property and one or
 * more pieces of equipment, resolves/creates equipment rows as needed,
 * computes manufacturer + craftsmanship expiration dates, and inserts the
 * document. Shared by the documents/warranty/new form action and the
 * internal AI assistant's create_warranty tool so there's exactly one place
 * that knows this shape — same split as generateDocumentForCustomer.
 */
export async function createWarrantyForCustomer(
  input: CreateWarrantyInput
): Promise<{ documentId: string; docNumber: string }> {
  const { customerId, propertyId, technicianName, equipment } = input;

  if (!customerId) throw new Error("Customer is required");
  if (!propertyId) throw new Error("Property is required");
  if (!equipment || equipment.length === 0) throw new Error("Add at least one piece of equipment");

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

  for (const row of equipment) {
    let equipment_id = row.equipmentId || null;
    const model = row.model?.trim() || null;
    const serial_number = row.serialNumber?.trim() || null;
    const install_date = row.installDate || null;

    let equipmentLabel: string;

    if (!equipment_id) {
      const newType = row.newEquipmentType?.trim();
      const newBrand = row.newEquipmentBrand?.trim() || null;
      if (!newType) throw new Error("Pick existing equipment or provide a type for new equipment");

      const resolved = await resolveCustomerPropertyEquipment({
        customerId,
        propertyId,
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

    const docket_number = row.docketNumber?.trim() || null;
    const manufacturer_years = row.manufacturerYears ?? null;
    const registered = row.registered ?? false;
    const registration_date = row.registrationDate || null;

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
      customer_id: customerId,
      property_id: propertyId,
      status: "active",
      ai_generated: false,
      line_items: { technician_name: technicianName ?? null, items },
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  await syncDocumentToGraph(document.id);

  return { documentId: document.id, docNumber: doc_number };
}
