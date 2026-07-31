import { supabase } from "@/lib/supabase";

export type NewEquipmentInput = {
  type: string;
  brand?: string | null;
  model?: string | null;
  refrigerant_type?: string | null;
};

export type CustomerIntakeInput = {
  customerId?: string | null;
  customerName?: string | null;
  phone?: string | null;
  email?: string | null;
  smsConsent?: boolean;
  propertyId?: string | null;
  address?: string | null;
  equipmentId?: string | null;
  equipment?: NewEquipmentInput | null;
};

export type CustomerIntakeResult = {
  customerId: string | null;
  propertyId: string | null;
  equipmentId: string | null;
};

/**
 * Find-or-create a customer, then find-or-create a property under them (by
 * address match), then optionally find-or-create equipment under that
 * property. Each step short-circuits if an id was already provided. Shared by
 * the AI receptionist's booking tool, the customer-optional diagnostic flow,
 * and the diagnostic "assign customer" backfill flow — all three need the
 * same walk-in-style intake.
 */
export async function resolveCustomerPropertyEquipment(
  input: CustomerIntakeInput
): Promise<CustomerIntakeResult> {
  let customerId = input.customerId ?? null;

  if (!customerId) {
    if (!input.customerName) {
      throw new Error("Customer name is required to create a new customer record");
    }
    const { data: newCustomer, error } = await supabase
      .from("customers")
      .insert({
        name: input.customerName,
        phone: input.phone || null,
        email: input.email || null,
        sms_consent: !!input.smsConsent,
        sms_consent_at: input.smsConsent ? new Date().toISOString() : null,
      })
      .select("id")
      .single();
    if (error || !newCustomer) throw new Error(`Failed to create customer: ${error?.message}`);
    customerId = newCustomer.id;
  }

  let propertyId = input.propertyId ?? null;

  if (!propertyId) {
    if (!input.address) {
      return { customerId, propertyId: null, equipmentId: null };
    }
    const { data: existingProperties } = await supabase
      .from("properties")
      .select("id, address")
      .eq("customer_id", customerId);
    propertyId =
      existingProperties?.find(
        (p) => p.address.trim().toLowerCase() === input.address!.trim().toLowerCase()
      )?.id ?? null;

    if (!propertyId) {
      const { data: newProperty, error } = await supabase
        .from("properties")
        .insert({ customer_id: customerId, address: input.address })
        .select("id")
        .single();
      if (error || !newProperty) throw new Error(`Failed to create property: ${error?.message}`);
      propertyId = newProperty.id;
    }
  }

  let equipmentId = input.equipmentId ?? null;

  if (!equipmentId && input.equipment) {
    const { data: newEquipment, error } = await supabase
      .from("equipment")
      .insert({
        property_id: propertyId,
        type: input.equipment.type,
        brand: input.equipment.brand || null,
        model: input.equipment.model || null,
        refrigerant_type: input.equipment.refrigerant_type || null,
      })
      .select("id")
      .single();
    if (error || !newEquipment) throw new Error(`Failed to create equipment: ${error?.message}`);
    equipmentId = newEquipment.id;
  }

  return { customerId, propertyId, equipmentId };
}
