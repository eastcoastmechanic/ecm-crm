import { supabase } from "@/lib/supabase";

async function must(
  result: { error: { message: string } | null },
  action: string,
): Promise<void> {
  if (result.error) throw new Error(`${action}: ${result.error.message}`);
}

export async function idsWhere(table: string, column: string, value: string): Promise<string[]> {
  const { data } = await supabase.from(table).select("id").eq(column, value);
  return (data ?? []).map((row) => row.id as string);
}

export async function idsWhereIn(table: string, column: string, values: string[]): Promise<string[]> {
  if (values.length === 0) return [];
  const { data } = await supabase.from(table).select("id").in(column, values);
  return (data ?? []).map((row) => row.id as string);
}

export function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

// Clears everything that references this equipment before the caller deletes
// the equipment rows themselves. Leads are unlinked rather than deleted —
// they don't belong to the equipment, they just point at it.
export async function cascadeUnlinkEquipment(equipmentIds: string[]): Promise<void> {
  if (equipmentIds.length === 0) return;
  await must(
    await supabase.from("diagnostics").delete().in("equipment_id", equipmentIds),
    "delete diagnostics by equipment",
  );
  await must(
    await supabase.from("install_reports").delete().in("equipment_id", equipmentIds),
    "delete install reports by equipment",
  );
  await must(
    await supabase.from("leads").update({ equipment_id: null }).in("equipment_id", equipmentIds),
    "unlink leads from equipment",
  );
}

// Clears everything that references these jobs before the caller deletes the
// job rows themselves. Tasks are unlinked rather than deleted — same reason.
export async function cascadeUnlinkJobs(jobIds: string[]): Promise<void> {
  if (jobIds.length === 0) return;
  await must(await supabase.from("diagnostics").delete().in("job_id", jobIds), "delete diagnostics by job");
  await must(
    await supabase.from("satisfaction_surveys").delete().in("job_id", jobIds),
    "delete surveys by job",
  );
  await must(await supabase.from("sms_messages").delete().in("job_id", jobIds), "delete sms by job");
  await must(
    await supabase.from("install_reports").delete().in("job_id", jobIds),
    "delete install reports by job",
  );
  await must(await supabase.from("tasks").update({ job_id: null }).in("job_id", jobIds), "unlink tasks from jobs");
}

// Unlinks anything that still points at these documents so a delete is never
// blocked by a leftover FK (a job converted from an estimate, a diagnostic
// that produced an invoice). Throws if the unlink does not actually clear
// jobs.document_id — that is the constraint that surfaces as
// jobs_document_id_fkey when the document row is deleted.
export async function cascadeUnlinkDocuments(documentIds: string[]): Promise<void> {
  if (documentIds.length === 0) return;

  await must(
    await supabase.from("jobs").update({ document_id: null }).in("document_id", documentIds),
    "unlink jobs.document_id",
  );
  await must(
    await supabase.from("diagnostics").update({ invoice_document_id: null }).in("invoice_document_id", documentIds),
    "unlink diagnostics.invoice_document_id",
  );

  const leftoverJobIds = await idsWhereIn("jobs", "document_id", documentIds);
  if (leftoverJobIds.length) {
    throw new Error(
      `Could not unlink ${leftoverJobIds.length} job(s) from this document before delete`,
    );
  }
}
