import { describe, expect, it } from "vitest";
import { balanceDueCents, centsToDollars, formatMoney, parseMoneyToCents } from "../job-invoice-rules";

describe("parseMoneyToCents", () => {
  it("reads plain and formatted amounts", () => {
    expect(parseMoneyToCents("1234.5")).toBe(123450);
    expect(parseMoneyToCents("$1,234.50")).toBe(123450);
    expect(parseMoneyToCents(" 0 ")).toBe(0);
  });
  it("rejects blanks, junk and negatives", () => {
    expect(parseMoneyToCents("")).toBeNull();
    expect(parseMoneyToCents("abc")).toBeNull();
    expect(parseMoneyToCents("-5")).toBeNull();
  });
  it("rounds to the cent", () => {
    expect(parseMoneyToCents("10.005")).toBe(1001);
  });
});

describe("balanceDueCents", () => {
  it("is total minus deposit received", () => {
    expect(balanceDueCents(1000000, 333300)).toBe(666700);
  });
  it("treats an unknown deposit as nothing received", () => {
    expect(balanceDueCents(500000, null)).toBe(500000);
  });
  it("never goes negative", () => {
    expect(balanceDueCents(100000, 150000)).toBe(0);
  });
});

describe("money formatting", () => {
  it("formats cents", () => {
    expect(formatMoney(666700)).toBe("$6,667.00");
    expect(centsToDollars(666700)).toBe(6667);
  });
});
