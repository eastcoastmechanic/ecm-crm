import { supabase } from "@/lib/supabase";
import { listSquareCustomers } from "@/lib/square";
import { IMPORTED_SMS_CONSENT, planCustomerImport, type ImportPlan } from "@/lib/square-import-rules";

export type SquareImportResult = {
  error?: string;
  dryRun: boolean;
  squareTotal: number;
  willCreate: number;
  willLink: number;
  alreadyLinked: number;
  skipped: number;
  created: number;
  linked: number;
  failed: number;
};

const empty = (dryRun: boolean): SquareImportResult => ({
  dryRun,
  squareTotal: 0,
  willCreate: 0,
  willLink: 0,
  alreadyLinked: 0,
  skipped: 0,
  created: 0,
  linked: 0,
  failed: 0,
});

/**
 * Read-only against Square. Dry run counts what would change; the real run creates CRM customers
 * for Square customers not already here and links matches by email or phone. Imported customers
 * are saved with no text consent, because Square holds no opt-in for the CRM.
 * Safe to run again: anything already linked is skipped.
 */
export async function importSquareCustomers(dryRun: boolean): Promise<SquareImportResult> {
  const out = empty(dryRun);
  let square;
  try {
    square = await listSquareCustomers();
  } catch (err) {
    return { ...out, error: err instanceof Error ? err.message : "Could not read Square customers." };
  }
  out.squareTotal = square.length;

  const { data: crm, error } = await supabase.from("customers").select("id, email, phone, square_customer_id");
  if (error) return { ...out, error: error.message };

  const plan: ImportPlan = planCustomerImport(
    square,
    (crm ?? []) as { id: string; email: string | null; phone: string | null; square_customer_id: string | null }[]
  );
  out.willCreate = plan.toCreate.length;
  out.willLink = plan.toLink.length;
  out.alreadyLinked = plan.alreadyLinked;
  out.skipped = plan.skipped;
  if (dryRun) return out;

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
    if (insertError) out.failed += batch.length;
    else out.created += batch.length;
  }
  return out;
}
