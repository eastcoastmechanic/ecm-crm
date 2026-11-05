"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { requireOffice } from "@/lib/require-role";
import { parseEtLocal } from "@/lib/tz";
import { recomputeTrackedHours } from "@/lib/time-clock";

type Table = "time_shifts" | "job_time_entries";
const TABLES: Table[] = ["time_shifts", "job_time_entries"];

function readTarget(formData: FormData): { table: Table; id: string } | null {
  const table = String(formData.get("table") ?? "") as Table;
  const id = String(formData.get("id") ?? "").trim();
  return TABLES.includes(table) && id ? { table, id } : null;
}

/** Office accepts a flagged row as it is. */
export async function markTimeReviewed(formData: FormData): Promise<void> {
  await requireOffice();
  const target = readTarget(formData);
  if (!target) return;
  await supabase.from(target.table).update({ reviewed_at: new Date().toISOString() }).eq("id", target.id);
  revalidatePath("/hours");
}

/** Office fixes the end time of a forgotten clock-out or job timer (New York time), then marks it reviewed. */
export async function fixTimeEnd(formData: FormData): Promise<void> {
  await requireOffice();
  const target = readTarget(formData);
  if (!target) return;
  const next = parseEtLocal(String(formData.get("ended_at") ?? ""));
  if (!next) return;

  const { data: row } = await supabase.from(target.table).select("*").eq("id", target.id).maybeSingle();
  if (!row || next.getTime() < new Date(row.started_at as string).getTime()) return;

  await supabase
    .from(target.table)
    .update({ ended_at: next.toISOString(), source: "office", reviewed_at: new Date().toISOString() })
    .eq("id", target.id);
  if (target.table === "job_time_entries" && row.job_id) await recomputeTrackedHours(row.job_id as string);
  revalidatePath("/hours");
}
