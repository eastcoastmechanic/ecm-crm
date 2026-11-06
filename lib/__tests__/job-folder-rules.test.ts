import { describe, expect, it } from "vitest";
import { folderNameForAddress } from "@/lib/job-folder-rules";

describe("folderNameForAddress", () => {
  it("drops commas, state and zip so it matches the existing street-and-town folders", () => {
    expect(folderNameForAddress("17 Lisas Ln, Pembroke, MA 02359")).toBe("17 Lisas Ln Pembroke");
    expect(folderNameForAddress("17 Lisas Ln, Pembroke")).toBe("17 Lisas Ln Pembroke");
    expect(folderNameForAddress("65 Hickory Lane Wrentham")).toBe("65 Hickory Lane Wrentham");
    expect(folderNameForAddress("70 Pioneer Trl, Plymouth, MA")).toBe("70 Pioneer Trl Plymouth");
  });

  it("removes characters SharePoint rejects and collapses spaces", () => {
    expect(folderNameForAddress("5 A/B St,  Kingston")).toBe("5 A B St Kingston");
    expect(folderNameForAddress('12 "Main" St: Duxbury?')).toBe("12 Main St Duxbury");
  });

  it("strips trailing dots and spaces", () => {
    expect(folderNameForAddress("9 Elm St. ")).toBe("9 Elm St");
  });

  it("returns null when there is nothing usable", () => {
    expect(folderNameForAddress(null)).toBeNull();
    expect(folderNameForAddress("   ")).toBeNull();
    expect(folderNameForAddress("..")).toBeNull();
  });
});
