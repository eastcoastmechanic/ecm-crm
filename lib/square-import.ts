import { supabase } from "@/lib/supabase";
import { listSquareCustomers, type SquareCustomer } from "@/lib/square";
import { IMPORTED_SMS_CONSENT, planCustomerImport, type ImportPlan } from "@/lib/square-import-rules";
import { afterImport, planSquareFill, type FillCrmCust, type FillPlan, type FillProperty } from "@/lib/square-fill-rules";

export type SquareImportResult = {
  error?: string;
  dryRun: boolean;
  squareTotal: number;
  willCreate: number;
  willLink: number;
  alreadyLinked: number;
  skipped: number;
  /** Customers that get at least one empty field (email, phone, company, billing address) filled. */
  willFillFields: number;
  willAddNotes: number;
  willAddProperties: number;
  created: number;
  linked: number;
  filled: number;
  notesAdded: number;
  propertiesAdded: number;
  failed: number;
};

export const emptyImportResult = (dryRun: boolean): SquareImportResult => ({
  dryRun,
  squareTotal: 0,
  willCreate: 0,
  willLink: 0,
  alreadyLinked: 0,
  skipped: 0,
  willFillFields: 0,
  willAddNotes: 0,
  willAddProperties: 0,
  created: 0,
  linked: 0,
  filled: 0,
  notesAdded: 0,
  propertiesAdded: 0,
  failed: 0,
});

type CrmRow = FillCrmCust;
const CRM_COLUMNS = "id, name, email, phone, company_name, billing_address, notes, square_customer_id";

// PostgREST returns at most 1000 rows a call, so read in pages. A short read would make existing
// customers look new (imported twice) or existing properties look missing (added twice).
async function readAll<T>(table: string, columns: string): Promise<{ rows: T[]; error?: string }> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data: page, error } = await supabase.from(table).select(columns).order("id").range(from, from + 999);
    if (error) return { rows, error: error.message };
    rows.push(...((page ?? []) as T[]));
    if (!page || page.length < 1000) break;
  }
  return { rows };
}

async function readCrm(): Promise<{ error: string } | { error?: undefined; customers: CrmRow[]; properties: FillProperty[] }> {
  const customers = await readAll<CrmRow>("customers", CRM_COLUMNS);
  if (customers.error) return { error: customers.error };
  const properties = await readAll<FillProperty>("properties", "id, customer_id, address");
  if (properties.error) return { error: properties.error };
  return { customers: customers.rows, properties: properties.rows };
}

/**
 * Read-only against Square. Dry run counts what would change; the real run creates CRM customers
 * for Square customers not already here, links matches by email or phone, then fills gaps from
 * Square on every linked customer: empty email, phone, company and billing address, a property at
 * the Square address when the customer has none there, and the Square note added to the notes.
 * Nothing already in the CRM is overwritten. Imported customers are saved with no text consent,
 * because Square holds no opt-in for the CRM. Safe to run again.
 */
export async function importSquareCustomers(dryRun: boolean): Promise<SquareImportResult> {
  const out = emptyImportResult(dryRun);
  let square: SquareCustomer[];
  try {
    square = await listSquareCustomers();
  } catch (err) {
    return { ...out, error: err instanceof Error ? err.message : "Could not read Square customers." };
  }
  out.squareTotal = square.length;

  const before = await readCrm();
  if (before.error !== undefined) return { ...out, error: before.error };

  const plan: ImportPlan = planCustomerImport(square, before.customers);
  out.willCreate = plan.toCreate.length;
  out.willLink = plan.toLink.length;
  out.alreadyLinked = plan.alreadyLinked;
  out.skipped = plan.skipped;

  if (dryRun) {
    const fill = planSquareFill(square, afterImport(before.customers, plan), before.properties);
    out.willFillFields = fill.fieldsToFill;
    out.willAddNotes = fill.notesToAdd;
    out.willAddProperties = fill.propertiesToAdd;
    return out;
  }

  for (const link of plan.toLink) {
    const { error: linkError } = await supabase
      .from("customers")
      .update({ square_customer_id: link.squareId })
      .eq("id", link.crmId)
      .is("square_customer_id", null);
    if (linkError) out.failed += 1;
    else out.linked += 1;
  }

  const rows = plan.toCreate.map((c) => ({
    name: c.name,
    company_name: c.company_name,
    email: c.email,
    phone: c.phone,
    square_customer_id: c.square_customer_id,
    sms_consent: IMPORTED_SMS_CONSENT,
    sms_consent_at: null,
  }));
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const { error: insertError } = await supabase.from("customers").insert(batch);
    if (!insertError) {
      out.created += batch.length;
      continue;
    }
    // One bad row (for example a Square id that was linked a moment ago) must not sink the other 99.
    for (const row of batch) {
      const { error: rowError } = await supabase.from("customers").insert(row);
      if (rowError) out.failed += 1;
      else out.created += 1;
    }
  }

  // Fill from a fresh read, so new and just-linked customers are included with their real ids.
  const after = await readCrm();
  if (after.error !== undefined) {
    return { ...out, error: `Customers imported, but filling details failed: ${after.error}. Run again.` };
  }
  const fill = planSquareFill(square, after.customers, after.properties);
  out.willFillFields = fill.fieldsToFill;
  out.willAddNotes = fill.notesToAdd;
  out.willAddProperties = fill.propertiesToAdd;
  await applyFill(fill, new Map(after.customers.map((c) => [c.id, c])), out);
  return out;
}

type FillKey = "email" | "phone" | "company_name" | "billing_address" | "notes";

async function applyFill(fill: FillPlan, crm: Map<string, CrmRow>, out: SquareImportResult) {
  for (const f of fill.fills) {
    const current = crm.get(f.crmId);
    if (!current) continue;
    const update: Partial<Record<FillKey, string>> = { ...f.fields };
    if (f.notes) update.notes = f.notes.after;

    const keys = Object.keys(update) as FillKey[];
    if (keys.length) {
      // Only write if every field still holds what we read, so an edit made a moment ago is never overwritten.
      let q = supabase.from("customers").update(update).eq("id", f.crmId);
      for (const key of keys) {
        const was = current[key];
        q = was === null ? q.is(key, null) : q.eq(key, was);
      }
      const { data, error } = await q.select("id");
      if (error || !data?.length) out.failed += 1;
      else {
        if (Object.keys(f.fields).length) out.filled += 1;
        if (f.notes) out.notesAdded += 1;
      }
    }

    if (f.propertyAddress) {
      const { error } = await supabase.from("properties").insert({ customer_id: f.crmId, address: f.propertyAddress });
      if (error) out.failed += 1;
      else out.propertiesAdded += 1;
    }
  }
}
