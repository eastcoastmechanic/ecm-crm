import { describe, expect, it } from "vitest";
import {
  conflictMessage,
  decodeManufactureDate,
  mergeNameplateExtras,
  mergeNameplateIdentity,
  type NameplateIdentity,
} from "@/lib/pm/nameplate";

const empty: NameplateIdentity = {
  brand: null,
  model: null,
  serial_number: null,
  manufacture_date: null,
  type: null,
  refrigerant_type: null,
};

describe("decodeManufactureDate", () => {
  const now = new Date("2026-10-21T12:00:00Z");

  it("decodes Carrier-family week and year", () => {
    expect(decodeManufactureDate("Bryant", "4215C75386", now)).toBe("Week 42, 2015");
    expect(decodeManufactureDate("Carrier", "*4215C75386*", now)).toBe("Week 42, 2015");
  });

  it("decodes Goodman-family year and month", () => {
    expect(decodeManufactureDate("Goodman", "1404123456", now)).toBe("April 2014");
  });

  it("returns null when the brand or the code is not one we can decode", () => {
    expect(decodeManufactureDate("Trane", "4215C75386", now)).toBeNull();
    expect(decodeManufactureDate("Bryant", "ABC123", now)).toBeNull();
    expect(decodeManufactureDate(null, "4215C75386", now)).toBeNull();
    expect(decodeManufactureDate("Bryant", "9925ABC", now)).toBeNull();
  });
});

describe("mergeNameplateIdentity", () => {
  const existing: NameplateIdentity = {
    ...empty,
    brand: "Lennox",
    model: "SL280",
    serial_number: null,
  };

  it("fills blanks and leaves existing values untouched without confirmation", () => {
    const result = mergeNameplateIdentity(
      existing,
      { ...empty, brand: "Carrier", model: "SL280", serial_number: "4215C75386", manufacture_date: "Week 42, 2015" },
      new Set()
    );
    expect(result.conflicts).toEqual(["brand"]);
    expect(result.next.brand).toBe("Lennox");
    expect(result.next.model).toBe("SL280");
    expect(result.next.serial_number).toBe("4215C75386");
    expect(result.next.manufacture_date).toBe("Week 42, 2015");
    expect(conflictMessage(result.conflicts)).toContain("Manufacturer");
  });

  it("overwrites only the fields the tech confirmed", () => {
    const result = mergeNameplateIdentity(
      existing,
      { ...empty, brand: "Carrier", model: "SL280" },
      new Set(["brand"])
    );
    expect(result.conflicts).toEqual([]);
    expect(result.overwritten).toEqual(["brand"]);
    expect(result.next.brand).toBe("Carrier");
    expect(result.next.model).toBe("SL280");
  });

  it("does not blank out a stored value when the proposal is empty", () => {
    const result = mergeNameplateIdentity(existing, empty, new Set(["brand", "model"]));
    expect(result.next.brand).toBe("Lennox");
    expect(result.next.model).toBe("SL280");
    expect(result.conflicts).toEqual([]);
  });
});

describe("mergeNameplateExtras", () => {
  it("fills empty plate details and keeps ones already stored", () => {
    const next = mergeNameplateExtras(
      { voltage: "208/230", manufacture_date: "July 2020" },
      { voltage: "460", phase: "1", manufacture_date: "Week 42, 2015" },
      "plates/new.jpg"
    );
    expect(next.voltage).toBe("208/230");
    expect(next.phase).toBe("1");
    expect(next.manufacture_date).toBe("July 2020");
    expect(next.photo_path).toBe("plates/new.jpg");
  });
});
