import { supabase } from "@/lib/supabase";

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
  await supabase.from("diagnostics").delete().in("equipment_id", equipmentIds);
  await supabase.from("leads").update({ equipment_id: null }).in("equipment_id", equipmentIds);
}

// Clears everything that references these jobs before the caller deletes the
// job rows themselves. Tasks are unlinked rather than deleted — same reason.
export async function cascadeUnlinkJobs(jobIds: string[]): Promise<void> {
  if (jobIds.length === 0) return;
  await supabase.from("diagnostics").delete().in("job_id", jobIds);
  await supabase.from("satisfaction_surveys").delete().in("job_id", jobIds);
  await supabase.from("sms_messages").delete().in("job_id", jobIds);
  await supabase.from("tasks").update({ job_id: null }).in("job_id", jobIds);
}
