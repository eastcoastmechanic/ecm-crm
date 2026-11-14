// Pure rules for filling gaps on CRM customers from their linked Square record. No database
// imports so they can be tested. Nothing is overwritten: a CRM field is only filled when it is
// empty, a property is only added when the customer has none at that street address, and the
// Square note is only appended when the CRM notes don't already hold it.

import type { SquareAddress } from "./square";
import type { ImportPlan } from "./square-import-rules";

export type FillSquareCust = {
  id?: string;
  company_name?: string;
  email_address?: string;
  phone_number?: string;
  address?: SquareAddress;
  note?: string;
};

export type FillCrmCust = {
  id: string;
  name: string | null;
  square_customer_id: string | null;
  email: string | null;
  phone: string | null;
  company_name: string | null;
  billing_address: string | null;
  notes: string | null;
};

export type FillProperty = { customer_id: string | null; address: string | null };

export type CustomerFill = {
  crmId: string;
  /** Only fields that are empty in the CRM today. */
  fields: Partial<Record<"email" | "phone" | "company_name" | "billing_address", string>>;
  /** Present only when the Square note is not already in the CRM notes. */
  notes?: { before: string | null; after: string };
  /** Present only when the customer has no property at this street address. */
  propertyAddress?: string;
};

export type FillPlan = {
  fills: CustomerFill[];
  fieldsToFill: number;
  notesToAdd: number;
  propertiesToAdd: number;
};

const blank = (s: string | null | undefined) => !(s ?? "").trim();

/** "12 Main St, Unit 2, Plymouth, MA 02360". Null when Square has no street line (city alone is not a service address). */
export function squareAddressText(a: SquareAddress | undefined): string | null {
  if (!a) return null;
  const line1 = (a.address_line_1 ?? "").trim();
  if (!line1) return null;
  const stateZip = [a.administrative_district_level_1, a.postal_code].map((s) => (s ?? "").trim()).filter(Boolean).join(" ");
  return [line1, (a.address_line_2 ?? "").trim(), (a.locality ?? "").trim(), stateZip].filter(Boolean).join(", ");
}

const SUFFIX: Record<string, string> = {
  street: "st",
  road: "rd",
  avenue: "ave",
  drive: "dr",
  lane: "ln",
  court: "ct",
  circle: "cir",
  place: "pl",
  terrace: "ter",
  boulevard: "blvd",
  highway: "hwy",
  parkway: "pkwy",
};

/** Lowercase, punctuation to spaces, common street words shortened, so "12 Main Street." == "12 main st". */
export function normalizeAddress(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((w) => SUFFIX[w] ?? w)
    .join(" ");
}

/** True when an existing property already covers this Square street line (same street, any city/zip formatting). */
export function hasPropertyAt(existing: (string | null)[], a: SquareAddress | undefined): boolean {
  const line1 = normalizeAddress(a?.address_line_1);
  if (!line1) return true;
  return existing.some((addr) => {
    const n = normalizeAddress(addr);
    return n === line1 || n.startsWith(`${line1} `);
  });
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** The CRM notes with the Square note added at the end, or null when it is already there or empty. */
export function appendSquareNote(current: string | null, note: string | undefined): string | null {
  const n = (note ?? "").trim();
  if (!n) return null;
  if (current && squash(current).includes(squash(n))) return null;
  return blank(current) ? n : `${(current ?? "").trimEnd()}\n\nFrom Square: ${n}`;
}

/**
 * For every CRM customer linked to a Square record, what to fill from Square. Customers with no
 * Square link, or whose Square record is gone, get nothing.
 */
export function planSquareFill(square: FillSquareCust[], crm: FillCrmCust[], properties: FillProperty[]): FillPlan {
  const bySquareId = new Map<string, FillSquareCust>();
  for (const s of square) if (s.id && !bySquareId.has(s.id)) bySquareId.set(s.id, s);
  const propsByCustomer = new Map<string, (string | null)[]>();
  for (const p of properties) {
    if (!p.customer_id) continue;
    const list = propsByCustomer.get(p.customer_id) ?? [];
    list.push(p.address);
    propsByCustomer.set(p.customer_id, list);
  }

  const plan: FillPlan = { fills: [], fieldsToFill: 0, notesToAdd: 0, propertiesToAdd: 0 };
  for (const c of crm) {
    const s = c.square_customer_id ? bySquareId.get(c.square_customer_id) : undefined;
    if (!s) continue;
    const fill: CustomerFill = { crmId: c.id, fields: {} };
    const address = squareAddressText(s.address);

    const candidates: [keyof CustomerFill["fields"], string | null, string | undefined | null][] = [
      ["email", c.email, s.email_address],
      ["phone", c.phone, s.phone_number],
      ["company_name", c.company_name, s.company_name],
      ["billing_address", c.billing_address, address],
    ];
    for (const [key, crmValue, squareValue] of candidates) {
      const v = (squareValue ?? "").trim();
      if (!blank(crmValue) || !v) continue;
      // A company name that is just the customer's own name adds nothing.
      if (key === "company_name" && squash(v) === squash(c.name ?? "")) continue;
      fill.fields[key] = v;
    }

    const notes = appendSquareNote(c.notes, s.note);
    if (notes !== null) fill.notes = { before: c.notes, after: notes };

    if (address && !hasPropertyAt(propsByCustomer.get(c.id) ?? [], s.address)) fill.propertyAddress = address;

    const fieldCount = Object.keys(fill.fields).length;
    if (!fieldCount && !fill.notes && !fill.propertyAddress) continue;
    plan.fills.push(fill);
    if (fieldCount) plan.fieldsToFill += 1;
    if (fill.notes) plan.notesToAdd += 1;
    if (fill.propertyAddress) plan.propertiesToAdd += 1;
  }
  return plan;
}

/** What the CRM would look like after linking and creating, so the dry run can count the fills too. */
export function afterImport(crm: FillCrmCust[], plan: ImportPlan): FillCrmCust[] {
  const links = new Map(plan.toLink.map((l) => [l.crmId, l.squareId]));
  const linked = crm.map((c) => {
    const squareId = links.get(c.id);
    return squareId ? { ...c, square_customer_id: squareId } : c;
  });
  const created: FillCrmCust[] = plan.toCreate.map((n) => ({
    id: `new:${n.square_customer_id}`,
    name: n.name,
    email: n.email,
    phone: n.phone,
    company_name: n.company_name,
    billing_address: null,
    notes: null,
    square_customer_id: n.square_customer_id,
  }));
  return [...linked, ...created];
}
