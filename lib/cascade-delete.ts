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

// Always resolve jobs by document_id, then write document_id=null on the job
// primary key. If that still leaves a pointer (NOT NULL in some live DBs),
// delete the job after unlinking its children. 0039 also makes the FK
// ON DELETE SET NULL so the database itself will not block a document delete.
export async function cascadeUnlinkDocuments(documentIds: string[]): Promise<void> {
  if (documentIds.length === 0) return;

  const jobIds: string[] = [];
  for (const documentId of documentIds) {
    const { data, error } = await supabase.from("jobs").select("id").eq("document_id", documentId);
    if (error) throw new Error(`find jobs for document: ${error.message}`);
    for (const row of data ?? []) jobIds.push(row.id as string);
  }

  const uniqueJobIds = unique(jobIds);
  if (uniqueJobIds.length) {
    for (const jobId of uniqueJobIds) {
      const { error: unlinkError } = await supabase.from("jobs").update({ document_id: null }).eq("id", jobId);
      if (unlinkError) {
        await cascadeUnlinkJobs([jobId]);
        await must(await supabase.from("jobs").delete().eq("id", jobId), `delete job ${jobId} still pointing at document`);
      }
    }

    const leftover = await idsWhereIn("jobs", "document_id", documentIds);
    if (leftover.length) {
      await cascadeUnlinkJobs(leftover);
      await must(
        await supabase.from("jobs").delete().in("id", leftover),
        "delete leftover jobs still pointing at document",
      );
    }
  }

  await must(
    await supabase.from("diagnostics").update({ invoice_document_id: null }).in("invoice_document_id", documentIds),
    "unlink diagnostics.invoice_document_id",
  );
}
