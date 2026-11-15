import { describe, expect, it } from "vitest";
import {
  catalogSheet,
  csvCell,
  customerSheet,
  dollars,
  etStamp,
  exportFolderPath,
  invoiceSheet,
  paymentSheet,
  refundSheet,
  toCsv,
} from "@/lib/square-export-rows";

const loc = (id?: string) => (id === "L1" ? "Main" : (id ?? ""));

describe("dollars and etStamp", () => {
  it("formats cents and New York time, blank when missing", () => {
    expect(dollars({ amount: 12550 })).toBe("125.50");
    expect(dollars(-40)).toBe("-0.40");
    expect(dollars(undefined)).toBe("");
    expect(etStamp("2026-07-01T16:05:00Z")).toBe("2026-07-01 12:05");
    expect(etStamp("2026-01-15T03:00:00Z")).toBe("2026-01-14 22:00");
    expect(etStamp(null)).toBe("");
    expect(etStamp("garbage")).toBe("");
  });
});

describe("csvCell / toCsv", () => {
  it("quotes commas, quotes and line breaks", () => {
    expect(csvCell('Say "hi", ok')).toBe('"Say ""hi"", ok"');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell(5)).toBe("5");
  });

  it("defuses anything Excel would run as a formula but keeps negative amounts", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+1 555")).toBe("'+1 555");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("-0.40")).toBe("-0.40");
  });

  it("keeps ZIPs, phones and card digits as text in Excel without making them live formulas", () => {
    expect(csvCell({ text: "02360" })).toBe(`"=""02360"""`);
    expect(csvCell({ text: "+15085550100" })).toBe(`"=""+15085550100"""`);
    expect(csvCell({ text: `a"b` })).toBe(`"=""a""""b"""`);
  });

  it("starts with a byte-order mark and uses Windows line ends", () => {
    const csv = toCsv({ header: ["A", "B"], rows: [["1", "x,y"]] });
    expect(csv).toBe('﻿A,B\r\n1,"x,y"\r\n');
  });
});

describe("row builders", () => {
  it("customers: one row each with the address split out", () => {
    const s = customerSheet([
      { id: "C1", given_name: "Pat", family_name: "Lee", email_address: "p@example.com", address: { locality: "Plymouth", postal_code: "02360" }, created_at: "2024-05-01T12:00:00Z" },
    ]);
    expect(s.rows).toHaveLength(1);
    const row = Object.fromEntries(s.header.map((h, i) => [h, s.rows[0][i]]));
    expect(row).toMatchObject({ "Square customer ID": "C1", "First name": "Pat", Town: "Plymouth", ZIP: { text: "02360" }, "Created (ET)": "2024-05-01 08:00" });
  });

  it("invoices: totals from payment requests and the location name", () => {
    const s = invoiceSheet(
      [
        {
          id: "I1",
          location_id: "L1",
          invoice_number: "0007",
          status: "PARTIALLY_PAID",
          primary_recipient: { given_name: "Pat", family_name: "Lee" },
          payment_requests: [
            { computed_amount_money: { amount: 50000, currency: "USD" }, total_completed_amount_money: { amount: 25000 }, due_date: "2024-06-01" },
            { computed_amount_money: { amount: 50000 }, total_completed_amount_money: { amount: 0 }, due_date: "2024-07-01" },
          ],
        },
      ],
      loc
    );
    const row = Object.fromEntries(s.header.map((h, i) => [h, s.rows[0][i]]));
    expect(row).toMatchObject({ Location: "Main", Customer: "Pat Lee", Total: "1000.00", Paid: "250.00", Due: "750.00", "Due date": "2024-07-01" });
  });

  it("payments and refunds: money, fees and card", () => {
    const p = paymentSheet(
      [{ id: "P1", location_id: "L1", status: "COMPLETED", amount_money: { amount: 10000 }, tip_money: { amount: 500 }, total_money: { amount: 10500, currency: "USD" }, refunded_money: { amount: 2500 }, processing_fee: [{ amount_money: { amount: 320 } }], card_details: { card: { card_brand: "VISA", last_4: "4242" } } }],
      loc
    );
    const prow = Object.fromEntries(p.header.map((h, i) => [h, p.rows[0][i]]));
    expect(prow).toMatchObject({ Amount: "100.00", Tip: "5.00", Total: "105.00", Refunded: "25.00", "Square fees": "3.20", "Card last 4": { text: "4242" } });

    const r = refundSheet([{ id: "R1", status: "COMPLETED", amount_money: { amount: 2500 }, reason: "Duplicate", payment_id: "P1" }], loc);
    const rrow = Object.fromEntries(r.header.map((h, i) => [h, r.rows[0][i]]));
    expect(rrow).toMatchObject({ Amount: "25.00", "Square fees": "", Reason: "Duplicate", "Square payment ID": "P1" });
  });

  it("catalog: one row per variation, category names, deleted items left out", () => {
    const s = catalogSheet([
      { id: "CAT", type: "CATEGORY", category_data: { name: "Service" } },
      {
        id: "IT1",
        type: "ITEM",
        item_data: {
          name: "Tune-up",
          categories: [{ id: "CAT" }],
          variations: [
            { id: "V1", item_variation_data: { name: "AC", price_money: { amount: 15000, currency: "USD" } } },
            { id: "V2", item_variation_data: { name: "Furnace", pricing_type: "VARIABLE_PRICING" } },
          ],
        },
      },
      { id: "IT2", type: "ITEM", item_data: { name: "Old", category_id: "CAT" } },
      { id: "IT3", type: "ITEM", is_deleted: true, item_data: { name: "Gone" } },
    ]);
    expect(s.rows.map((r) => [r[1], r[2], r[6], r[9]])).toEqual([
      ["Tune-up", "Service", "AC", "150.00"],
      ["Tune-up", "Service", "Furnace", ""],
      ["Old", "Service", "", ""],
    ]);
  });
});

describe("exportFolderPath", () => {
  it("puts each day in its own folder", () => {
    expect(exportFolderPath("2026-11-11")).toBe("Square Export/2026-11-11");
    expect(exportFolderPath("2026-11-11", "/Archive/")).toBe("Archive/2026-11-11");
  });
});
