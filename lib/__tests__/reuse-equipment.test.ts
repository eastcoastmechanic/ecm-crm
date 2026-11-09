import { beforeEach, describe, expect, it, vi } from "vitest";

const result = vi.hoisted(() => ({ value: { data: null as unknown, error: null as unknown } }));
const eqCalls = vi.hoisted(() => [] as [string, string][]);

vi.mock("@/lib/supabase", () => {
  const chain = {
    select: () => chain,
    eq: (col: string, val: string) => {
      eqCalls.push([col, val]);
      return chain;
    },
    maybeSingle: async () => result.value,
  };
  return { supabase: { from: () => chain } };
});

import { reusableEquipmentId } from "../reuse-equipment";

describe("reusableEquipmentId", () => {
  beforeEach(() => {
    eqCalls.length = 0;
    result.value = { data: null, error: null };
  });

  it("returns null without a lookup when no id was sent", async () => {
    expect(await reusableEquipmentId(null, "p1")).toBeNull();
    expect(await reusableEquipmentId("  ", "p1")).toBeNull();
    expect(eqCalls).toEqual([]);
  });

  it("reuses equipment that is on this property", async () => {
    result.value = { data: { id: "e1" }, error: null };
    expect(await reusableEquipmentId("e1", "p1")).toBe("e1");
    expect(eqCalls).toEqual([
      ["id", "e1"],
      ["property_id", "p1"],
    ]);
  });

  it("returns null for equipment that is not on this property", async () => {
    expect(await reusableEquipmentId("e1", "p2")).toBeNull();
  });

  it("throws when the lookup fails, so the caller does not add a duplicate", async () => {
    result.value = { data: null, error: { message: "timeout" } };
    await expect(reusableEquipmentId("e1", "p1")).rejects.toThrow("Equipment lookup failed");
  });
});
