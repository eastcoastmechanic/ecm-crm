import { describe, expect, it } from "vitest";
import { nextReportNumberFrom } from "../report-number";

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
