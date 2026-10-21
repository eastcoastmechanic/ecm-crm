import { describe, expect, it } from "vitest";
import { paymentTermsForPrice } from "../contract-terms";

const CAP_NOTICE =
  "Massachusetts law caps deposits on home-improvement contracts at one-third of the contract price, or the cost of special-order materials, whichever is greater.";

describe("paymentTermsForPrice (MA HIC deposit cap)", () => {
  it("defaults to a one-third deposit when there are no special-order materials", () => {
    const text = paymentTermsForPrice(9000);
    expect(text).toContain("A deposit of $3,000.00 (one-third) is due upon signing.");
    expect(text).toContain("The remaining $6,000.00 is due upon completion.");
    expect(text).toContain(CAP_NOTICE);
  });

  it("rounds one-third to cents and keeps deposit + balance equal to the price", () => {
    const text = paymentTermsForPrice(10000);
    expect(text).toContain("$3,333.33 (one-third)");
    expect(text).toContain("$6,666.67");
  });

  it("uses a 50% deposit when special-order materials cover half the price", () => {
    const text = paymentTermsForPrice(9000, 4500);
    expect(text).toContain("A 50% deposit of $4,500.00 is due upon signing");
    expect(text).toContain("The remaining $4,500.00 is due upon completion.");
    expect(text).toContain(CAP_NOTICE);
  });

  it("never exceeds 50% even when special-order materials cost more", () => {
    const text = paymentTermsForPrice(9000, 20000);
    expect(text).toContain("A 50% deposit of $4,500.00");
    expect(text).not.toContain("$9,000.00 is due upon signing");
  });

  it("raises the deposit to the materials cost when it is between one-third and 50%", () => {
    const text = paymentTermsForPrice(9000, 3800);
    expect(text).toContain("A deposit of $3,800.00");
    expect(text).toContain("The remaining $5,200.00 is due upon completion.");
    expect(text).not.toContain("50% deposit");
  });

  it("ignores special-order materials below one-third of the price", () => {
    const text = paymentTermsForPrice(9000, 1000);
    expect(text).toContain("A deposit of $3,000.00 (one-third)");
  });
});
