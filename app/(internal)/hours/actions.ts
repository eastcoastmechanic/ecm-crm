"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { requireOffice } from "@/lib/require-role";
import { getMyStaffId } from "@/lib/job-access";
import { addTime, editTime, voidTime } from "@/lib/time-edit";
import { TIME_TABLES, type TimeTable } from "@/lib/time-edit-rules";

type Result = { error?: string };

function readTable(formData: FormData): TimeTable | null {
  const table = String(formData.get("table") ?? "") as TimeTable;
  return TIME_TABLES.includes(table) ? table : null;
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

/** Office accepts a flagged row as it is. */
export async function markTimeReviewed(formData: FormData): Promise<void> {
  await requireOffice();
  const table = readTable(formData);
  const id = text(formData, "id").trim();
  if (!table || !id) return;
  await supabase.from(table).update({ reviewed_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/hours");
}

/** Office edits a shift (start, end, meal break) or a job timer (start, end, kind). New York time. */
export async function editTimeEntry(formData: FormData): Promise<Result> {
  await requireOffice();
  const table = readTable(formData);
  const id = text(formData, "id").trim();
  if (!table || !id) return { error: "Reload the page and try again." };
  const result = await editTime({
    table,
    id,
    start: text(formData, "started_at"),
    end: text(formData, "ended_at"),
    breakMinutes: text(formData, "break_minutes"),
    kind: text(formData, "kind"),
    reason: text(formData, "reason"),
    editedBy: await getMyStaffId(),
  });
  if (!result.error) revalidatePath("/hours");
  return result;
}

/** Office adds a missed day shift or job timer for one person. */
export async function addMissedTime(formData: FormData): Promise<Result> {
  await requireOffice();
  const table = readTable(formData);
  if (!table) return { error: "Pick a day shift or a job timer." };
  const result = await addTime({
    table,
    staffId: text(formData, "staff_id").trim(),
    jobId: text(formData, "job_id").trim() || undefined,
    kind: text(formData, "kind"),
    start: text(formData, "started_at"),
    end: text(formData, "ended_at"),
    breakMinutes: text(formData, "break_minutes"),
    reason: text(formData, "reason"),
    editedBy: await getMyStaffId(),
  });
  if (!result.error) revalidatePath("/hours");
  return result;
}

/** Office voids a shift or job timer: it stays on the page, greyed, and counts for nothing. */
export async function voidTimeEntry(formData: FormData): Promise<Result> {
  await requireOffice();
  const table = readTable(formData);
  const id = text(formData, "id").trim();
  if (!table || !id) return { error: "Reload the page and try again." };
  const result = await voidTime({ table, id, reason: text(formData, "reason"), editedBy: await getMyStaffId() });
  if (!result.error) revalidatePath("/hours");
  return result;
}
