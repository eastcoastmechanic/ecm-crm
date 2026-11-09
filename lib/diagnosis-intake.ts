/**
 * Who may add new customer details from the service report form.
 *
 * Office and owner can type a walk-in customer, address and a new unit, and tick
 * text consent (the report then makes the customer, property and equipment).
 * A tech cannot: creating customers and setting consent is office/owner only
 * (same rule as assignCustomer in #172). A tech's report always goes on their
 * own job's customer and address, and any unit they pick must be at that
 * address. Pure, so it is easy to test.
 */

export type WalkInFields = {
  customerName: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  smsConsent: boolean;
  newEquipmentType: string | null;
  newEquipmentBrand: string | null;
  newEquipmentModel: string | null;
  newEquipmentRefrigerant: string | null;
};

export const TECH_WALK_IN_MESSAGE =
  "The report goes on this job's customer and address. Leave the customer and new unit fields blank, and ask the office to add new details.";

/** Error for a tech who sent new customer, consent or unit details; null when there are none. */
export function techWalkInError(fields: WalkInFields): string | null {
  const typed = [
    fields.customerName,
    fields.customerPhone,
    fields.customerAddress,
    fields.newEquipmentType,
    fields.newEquipmentBrand,
    fields.newEquipmentModel,
    fields.newEquipmentRefrigerant,
  ].some((value) => !!value && value.trim() !== "");
  return typed || fields.smsConsent ? TECH_WALK_IN_MESSAGE : null;
}

export const TECH_EQUIPMENT_MESSAGE = "That unit isn't at this job's address. Pick one from the list, or leave it blank.";

/**
 * Error for a tech who picked a unit that is not at their job's address (or a
 * unit that doesn't exist, or a job with no address yet); null when it fits.
 */
export function techEquipmentError(input: {
  jobPropertyId: string | null;
  equipmentPropertyId: string | null;
}): string | null {
  if (!input.jobPropertyId || !input.equipmentPropertyId) return TECH_EQUIPMENT_MESSAGE;
  return input.jobPropertyId === input.equipmentPropertyId ? null : TECH_EQUIPMENT_MESSAGE;
}
