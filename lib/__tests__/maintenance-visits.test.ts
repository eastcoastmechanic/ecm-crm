import { describe, expect, it } from "vitest";
import { parseVisitMonths, visitDueNow, visitLabel, visitOverdue } from "../maintenance-visits";

describe("parseVisitMonths", () => {
  it("parses, dedupes and sorts", () => {
    expect(parseVisitMonths("10, 4 4")).toEqual([4, 10]);
  });
  it("returns null for blank", () => {
    expect(parseVisitMonths("  ")).toBeNull();
  });
  it("rejects bad months", () => {
    expect(() => parseVisitMonths("13")).toThrow();
    expect(() => parseVisitMonths("spring")).toThrow();
  });
});

describe("visitDueNow", () => {
  const plan = { visitMonths: [4, 10], startDate: "2026-03-15", endDate: "2027-03-15" };
  it("is due in a visit month inside the plan", () => {
    expect(visitDueNow({ ...plan, todayKey: "2026-10-20" })).toEqual({ year: 2026, month: 10 });
  });
  it("is not due in other months", () => {
    expect(visitDueNow({ ...plan, todayKey: "2026-11-01" })).toBeNull();
  });
  it("is not due before the plan starts or after it ends", () => {
    expect(visitDueNow({ ...plan, startDate: "2026-11-01", todayKey: "2026-10-20" })).toBeNull();
    expect(visitDueNow({ ...plan, todayKey: "2027-04-02" })).toBeNull();
  });
  it("invents nothing without a schedule", () => {
    expect(visitDueNow({ visitMonths: null, startDate: null, endDate: null, todayKey: "2026-04-02" })).toBeNull();
  });
});

describe("visitOverdue and labels", () => {
  it("is overdue only after its month passes", () => {
    expect(visitOverdue(2026, 10, "2026-10-31")).toBe(false);
    expect(visitOverdue(2026, 10, "2026-11-01")).toBe(true);
    expect(visitOverdue(2025, 12, "2026-01-02")).toBe(true);
  });
  it("names the decided tune-ups", () => {
    expect(visitLabel(4)).toBe("AC tune-up");
    expect(visitLabel(10)).toBe("Heating tune-up");
    expect(visitLabel(6)).toBe("Maintenance visit");
  });
});
