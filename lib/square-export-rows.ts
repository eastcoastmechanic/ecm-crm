// Pure row builders for the Square -> SharePoint export. No network here, so it
// can be tested. Each builder turns raw Square API records into spreadsheet rows
// (header + values). Money is in dollars ("125.00"), times in New York time.

import { toEtLocalInput } from "./tz";

type Money = { amount?: number; currency?: string } | undefined;

export type ExportAddress = {
  address_line_1?: string;
  address_line_2?: string;
  locality?: string;
  administrative_district_level_1?: string;
  postal_code?: string;
};

export type ExportCustomer = {
  id?: string;
  given_name?: string;
  family_name?: string;
  company_name?: string;
  nickname?: string;
  email_address?: string;
  phone_number?: string;
  address?: ExportAddress;
  reference_id?: string;
  note?: string;
  creation_source?: string;
  created_at?: string;
  updated_at?: string;
};

export type ExportInvoice = {
  id?: string;
  location_id?: string;
  invoice_number?: string;
  title?: string;
  status?: string;
  order_id?: string;
  public_url?: string;
  created_at?: string;
  updated_at?: string;
  scheduled_at?: string;
  primary_recipient?: {
    customer_id?: string;
    given_name?: string;
    family_name?: string;
    company_name?: string;
    email_address?: string;
    phone_number?: string;
  };
  next_payment_amount_money?: Money;
  payment_requests?: Array<{ due_date?: string; computed_amount_money?: Money; total_completed_amount_money?: Money }>;
};

export type ExportPayment = {
  id?: string;
  location_id?: string;
  status?: string;
  created_at?: string;
  order_id?: string;
  customer_id?: string;
  receipt_number?: string;
  receipt_url?: string;
  note?: string;
  source_type?: string;
  amount_money?: Money;
  tip_money?: Money;
  total_money?: Money;
  refunded_money?: Money;
  processing_fee?: Array<{ amount_money?: Money }>;
  card_details?: { card?: { card_brand?: string; last_4?: string } };
};

export type ExportRefund = {
  id?: string;
  location_id?: string;
  status?: string;
  created_at?: string;
  payment_id?: string;
  order_id?: string;
  reason?: string;
  destination_type?: string;
  amount_money?: Money;
  processing_fee?: Array<{ amount_money?: Money }>;
};

export type ExportCatalogObject = {
  id?: string;
  type?: string;
  is_deleted?: boolean;
  category_data?: { name?: string };
  item_data?: {
    name?: string;
    description?: string;
    category_id?: string;
    categories?: Array<{ id?: string }>;
    product_type?: string;
    variations?: Array<{
      id?: string;
      item_variation_data?: {
        name?: string;
        sku?: string;
        pricing_type?: string;
        price_money?: Money;
      };
    }>;
  };
};

/** A cell Excel must keep as typed text (leading zeros, a leading +). */
export type TextCell = { text: string };
export type Cell = string | number | TextCell;
export type Sheet = { header: string[]; rows: Cell[][] };

/** Keep as text in Excel; blank stays blank. */
export function asText(value: string | null | undefined): Cell {
  return value ? { text: value } : "";
}

/** Cents to "125.00". Blank when Square gave no amount. */
export function dollars(money: Money | number | null | undefined): string {
  const cents = typeof money === "number" ? money : money?.amount;
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "";
  return (cents / 100).toFixed(2);
}

/** "2026-11-11 10:05" New York time, or blank. */
export function etStamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return toEtLocalInput(d).replace("T", " ");
}

function fees(list: Array<{ amount_money?: Money }> | undefined): number | null {
  if (!list || list.length === 0) return null;
  return list.reduce((sum, f) => sum + (f.amount_money?.amount ?? 0), 0);
}

function join(...parts: (string | undefined)[]): string {
  return parts.filter((p) => p && p.trim()).join(" ").trim();
}

export function customerSheet(customers: ExportCustomer[]): Sheet {
  return {
    header: ["Square customer ID", "First name", "Last name", "Company", "Nickname", "Email", "Phone", "Street", "Street 2", "Town", "State", "ZIP", "Reference ID", "Note", "Source", "Created (ET)", "Updated (ET)"],
    rows: customers.map((c) => [
      c.id ?? "",
      c.given_name ?? "",
      c.family_name ?? "",
      c.company_name ?? "",
      c.nickname ?? "",
      c.email_address ?? "",
      asText(c.phone_number),
      c.address?.address_line_1 ?? "",
      c.address?.address_line_2 ?? "",
      c.address?.locality ?? "",
      c.address?.administrative_district_level_1 ?? "",
      asText(c.address?.postal_code),
      c.reference_id ?? "",
      c.note ?? "",
      c.creation_source ?? "",
      etStamp(c.created_at),
      etStamp(c.updated_at),
    ]),
  };
}

export function invoiceSheet(invoices: ExportInvoice[], locationName: (id?: string) => string): Sheet {
  return {
    header: ["Square invoice ID", "Invoice number", "Location", "Status", "Title", "Customer", "Customer email", "Customer phone", "Square customer ID", "Total", "Paid", "Due", "Currency", "Due date", "Created (ET)", "Updated (ET)", "Order ID", "Link"],
    rows: invoices.map((inv) => {
      const req = inv.payment_requests ?? [];
      const total = req.reduce((s, r) => s + (r.computed_amount_money?.amount ?? 0), 0);
      const paid = req.reduce((s, r) => s + (r.total_completed_amount_money?.amount ?? 0), 0);
      const due = inv.next_payment_amount_money?.amount ?? Math.max(total - paid, 0);
      const r = inv.primary_recipient ?? {};
      const dueDates = req.map((x) => x.due_date).filter(Boolean);
      return [
        inv.id ?? "",
        asText(inv.invoice_number),
        locationName(inv.location_id),
        inv.status ?? "",
        inv.title ?? "",
        join(r.given_name, r.family_name) || r.company_name || "",
        r.email_address ?? "",
        asText(r.phone_number),
        r.customer_id ?? "",
        dollars(total),
        dollars(paid),
        dollars(due),
        req[0]?.computed_amount_money?.currency ?? "USD",
        dueDates[dueDates.length - 1] ?? "",
        etStamp(inv.created_at),
        etStamp(inv.updated_at),
        inv.order_id ?? "",
        inv.public_url ?? "",
      ];
    }),
  };
}

export function paymentSheet(payments: ExportPayment[], locationName: (id?: string) => string): Sheet {
  return {
    header: ["Square payment ID", "Date (ET)", "Location", "Status", "Amount", "Tip", "Total", "Refunded", "Square fees", "Currency", "Source", "Card brand", "Card last 4", "Square customer ID", "Order ID", "Receipt number", "Receipt link", "Note"],
    rows: payments.map((p) => [
      p.id ?? "",
      etStamp(p.created_at),
      locationName(p.location_id),
      p.status ?? "",
      dollars(p.amount_money),
      dollars(p.tip_money),
      dollars(p.total_money ?? p.amount_money),
      dollars(p.refunded_money),
      dollars(fees(p.processing_fee)),
      p.total_money?.currency ?? p.amount_money?.currency ?? "USD",
      p.source_type ?? "",
      p.card_details?.card?.card_brand ?? "",
      asText(p.card_details?.card?.last_4),
      p.customer_id ?? "",
      p.order_id ?? "",
      asText(p.receipt_number),
      p.receipt_url ?? "",
      p.note ?? "",
    ]),
  };
}

export function refundSheet(refunds: ExportRefund[], locationName: (id?: string) => string): Sheet {
  return {
    header: ["Square refund ID", "Date (ET)", "Location", "Status", "Amount", "Square fees", "Currency", "Reason", "Refunded to", "Square payment ID", "Order ID"],
    rows: refunds.map((r) => [
      r.id ?? "",
      etStamp(r.created_at),
      locationName(r.location_id),
      r.status ?? "",
      dollars(r.amount_money),
      dollars(fees(r.processing_fee)),
      r.amount_money?.currency ?? "USD",
      r.reason ?? "",
      r.destination_type ?? "",
      r.payment_id ?? "",
      r.order_id ?? "",
    ]),
  };
}

/** One row per variation (price point); an item with no variations still gets a row. */
export function catalogSheet(objects: ExportCatalogObject[]): Sheet {
  const categoryName = new Map<string, string>();
  for (const o of objects) if (o.type === "CATEGORY" && o.id) categoryName.set(o.id, o.category_data?.name ?? "");

  const rows: Cell[][] = [];
  for (const o of objects) {
    if (o.type !== "ITEM" || o.is_deleted) continue;
    const item = o.item_data ?? {};
    const catIds = item.categories?.map((c) => c.id).filter((id): id is string => Boolean(id)) ?? (item.category_id ? [item.category_id] : []);
    const categories = catIds.map((id) => categoryName.get(id) ?? id).join("; ");
    const variations = item.variations?.length ? item.variations : [undefined];
    for (const v of variations) {
      const vd = v?.item_variation_data ?? {};
      rows.push([
        o.id ?? "",
        item.name ?? "",
        categories,
        item.product_type ?? "",
        item.description ?? "",
        v?.id ?? "",
        vd.name ?? "",
        asText(vd.sku),
        vd.pricing_type ?? "",
        dollars(vd.price_money),
        vd.price_money?.currency ?? "",
      ]);
    }
  }
  return {
    header: ["Square item ID", "Item", "Category", "Type", "Description", "Variation ID", "Variation", "SKU", "Pricing", "Price", "Currency"],
    rows,
  };
}

/**
 * One CSV cell. Quotes when needed, and puts a ' in front of anything Excel
 * would run as a formula (=, +, -, @, tab, return), so a name or note typed into
 * Square can never become a live formula in the spreadsheet. Plain numbers stay numbers.
 * A TextCell (ZIP, phone, invoice number, card last 4, SKU) is written as ="..." so
 * Excel keeps leading zeros and a leading +. Inside ="..." the value is a plain string
 * (its quotes doubled), so it can't run as a formula either.
 */
export function csvCell(value: Cell): string {
  if (typeof value === "object") {
    const formula = `="${value.text.replace(/[\r\n]+/g, " ").replaceAll('"', '""')}"`;
    return `"${formula.replaceAll('"', '""')}"`;
  }
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** CSV with a byte-order mark so Excel reads accents and symbols right. */
export function toCsv(sheet: Sheet): string {
  const lines = [sheet.header, ...sheet.rows].map((row) => row.map(csvCell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** "Square Export/2026-11-11" (the date is New York's). */
export function exportFolderPath(dateKey: string, parent = "Square Export"): string {
  return `${parent.replace(/^\/+|\/+$/g, "")}/${dateKey}`;
}
