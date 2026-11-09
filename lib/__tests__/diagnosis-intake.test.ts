import { describe, expect, it } from "vitest";
import {
  TECH_EQUIPMENT_MESSAGE,
  TECH_WALK_IN_MESSAGE,
  techEquipmentError,
  techWalkInError,
  type WalkInFields,
} from "../diagnosis-intake";

const blank: WalkInFields = {
  customerName: null,
  customerPhone: null,
  customerAddress: null,
  smsConsent: false,
  newEquipmentType: null,
  newEquipmentBrand: null,
  newEquipmentModel: null,
  newEquipmentRefrigerant: null,
};

describe("techWalkInError", () => {
  it("passes a tech with no new details", () => {
    expect(techWalkInError(blank)).toBeNull();
  });

  it("ignores whitespace-only fields", () => {
    expect(techWalkInError({ ...blank, customerName: "   " })).toBeNull();
  });

  it("refuses a new customer name, phone or address", () => {
    expect(techWalkInError({ ...blank, customerName: "A" })).toBe(TECH_WALK_IN_MESSAGE);
    expect(techWalkInError({ ...blank, customerPhone: "5" })).toBe(TECH_WALK_IN_MESSAGE);
    expect(techWalkInError({ ...blank, customerAddress: "1 Main" })).toBe(TECH_WALK_IN_MESSAGE);
  });

  it("refuses text consent from a tech, even with nothing else typed", () => {
    expect(techWalkInError({ ...blank, smsConsent: true })).toBe(TECH_WALK_IN_MESSAGE);
  });

  it("refuses a new unit", () => {
    expect(techWalkInError({ ...blank, newEquipmentType: "boiler" })).toBe(TECH_WALK_IN_MESSAGE);
    expect(techWalkInError({ ...blank, newEquipmentRefrigerant: "R-410A" })).toBe(TECH_WALK_IN_MESSAGE);
  });
});

describe("techEquipmentError", () => {
  it("passes a unit at the job's address", () => {
    expect(techEquipmentError({ jobPropertyId: "p1", equipmentPropertyId: "p1" })).toBeNull();
  });

  it("refuses a unit at another address", () => {
    expect(techEquipmentError({ jobPropertyId: "p1", equipmentPropertyId: "p2" })).toBe(TECH_EQUIPMENT_MESSAGE);
  });

  it("refuses when the job has no address or the unit isn't found", () => {
    expect(techEquipmentError({ jobPropertyId: null, equipmentPropertyId: "p1" })).toBe(TECH_EQUIPMENT_MESSAGE);
    expect(techEquipmentError({ jobPropertyId: "p1", equipmentPropertyId: null })).toBe(TECH_EQUIPMENT_MESSAGE);
  });
});
