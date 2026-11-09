import { describe, expect, it } from "vitest";
import { allocateReportNumberWith, nextReportNumberFrom } from "../report-number";

const missing = (error: { code?: string | null } | null) => error?.code === "PGRST202";

describe("allocateReportNumberWith", () => {
  it("uses the database number when next_report_number() exists", async () => {
    let loaded = false;
    const result = await allocateReportNumberWith({
      rpc: async () => ({ data: "RPT-1042", error: null }),
      isMissingFunction: missing,
      loadExisting: async () => {
        loaded = true;
        return [];
      },
    });
    expect(result).toEqual({ reportNumber: "RPT-1042" });
    expect(loaded).toBe(false);
  });

  it("falls back to highest + 1 before SQL 0072 is run", async () => {
    const result = await allocateReportNumberWith({
      rpc: async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function" } }),
      isMissingFunction: missing,
      loadExisting: async () => ["RPT-1001", "RPT-1007", null],
    });
    expect(result).toEqual({ reportNumber: "RPT-1008" });
  });

  it("falls back to RPT-1001 with no reports yet", async () => {
    const result = await allocateReportNumberWith({
      rpc: async () => ({ data: null, error: { code: "PGRST202" } }),
      isMissingFunction: missing,
      loadExisting: async () => [],
    });
    expect(result).toEqual({ reportNumber: "RPT-1001" });
  });

  it("returns { error } when the fallback read fails", async () => {
    const result = await allocateReportNumberWith({
      rpc: async () => ({ data: null, error: { code: "PGRST202" } }),
      isMissingFunction: missing,
      loadExisting: async () => {
        throw new Error("read failed");
      },
    });
    expect(result.error).toMatch(/read failed/);
  });

  it("returns { error } for any other database error, without guessing a number", async () => {
    const result = await allocateReportNumberWith({
      rpc: async () => ({ data: null, error: { code: "57014", message: "timeout" } }),
      isMissingFunction: missing,
      loadExisting: async () => ["RPT-1001"],
    });
    expect(result.error).toMatch(/timeout/);
  });

  it("returns { error } when the database returns nothing usable", async () => {
    const result = await allocateReportNumberWith({
      rpc: async () => ({ data: null, error: null }),
      isMissingFunction: missing,
      loadExisting: async () => [],
    });
    expect(result.error).toBeDefined();
  });
});

describe("nextReportNumberFrom", () => {
  it("starts at RPT-1001", () => {
    expect(nextReportNumberFrom([])).toBe("RPT-1001");
  });

  it("uses the highest number, not the count, so a delete never repeats a live number", () => {
    // RPT-1002 was deleted: three rows left, but 1004 is taken.
    expect(nextReportNumberFrom(["RPT-1001", "RPT-1003", "RPT-1004"])).toBe("RPT-1005");
  });

  it("compares numbers, not text", () => {
    expect(nextReportNumberFrom(["RPT-999", "RPT-1010", "RPT-1009"])).toBe("RPT-1011");
  });

  it("ignores blanks and other formats", () => {
    expect(nextReportNumberFrom([null, undefined, "", "INV-5000", "RPT-abc", "RPT-1002"])).toBe("RPT-1003");
  });
});
