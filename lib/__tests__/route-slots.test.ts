import { describe, expect, it } from "vitest";
import { routeSlotTimes } from "../route-slots";

describe("routeSlotTimes", () => {
  it("starts at 8:00 AM New York and spaces stops 1.5 hours apart", () => {
    expect(routeSlotTimes("2026-11-10", 3)).toEqual(["2026-11-10T08:00", "2026-11-10T09:30", "2026-11-10T11:00"]);
  });

  it("stays on New York time in summer too", () => {
    expect(routeSlotTimes("2026-07-15", 2)).toEqual(["2026-07-15T08:00", "2026-07-15T09:30"]);
  });

  it("returns nothing for a bad date", () => {
    expect(routeSlotTimes("", 3)).toEqual([]);
  });
});
