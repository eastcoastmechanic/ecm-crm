"use server";

import { revalidatePath } from "next/cache";
import { getMyStaffId, requireJobAccess } from "@/lib/job-access";
import { requireRole } from "@/lib/require-role";
import { clockIn, clockOut, pauseJobEntry, startJobEntry } from "@/lib/time-clock";

type ClockResult = { error?: string };

async function myStaff(): Promise<{ staffId?: string; error?: string }> {
  await requireRole(["owner", "office", "tech"]);
  const staffId = await getMyStaffId();
  if (!staffId) return { error: "Your login is not linked to a staff record, so the clock is off." };
  return { staffId };
}

export async function clockInAction(): Promise<ClockResult> {
  const { staffId, error } = await myStaff();
  if (!staffId) return { error };
  const result = await clockIn(staffId);
  revalidatePath("/field-board");
  return result;
}

export async function clockOutAction(_prev: ClockResult | null, formData: FormData): Promise<ClockResult> {
  const { staffId, error } = await myStaff();
  if (!staffId) return { error };
  const raw = String(formData.get("break_minutes") ?? "").trim();
  const result = await clockOut(staffId, raw === "" ? null : Number(raw));
  revalidatePath("/field-board");
  return result;
}

export async function pauseJobAction(formData: FormData): Promise<void> {
  const jobId = String(formData.get("id") ?? "").trim();
  if (!jobId) return;
  await requireJobAccess(jobId);
  const staffId = await getMyStaffId();
  if (staffId) await pauseJobEntry(jobId, staffId);
  revalidatePath("/field-board");
}

export async function resumeJobAction(formData: FormData): Promise<void> {
  const jobId = String(formData.get("id") ?? "").trim();
  if (!jobId) return;
  await requireJobAccess(jobId);
  const staffId = await getMyStaffId();
  if (staffId) await startJobEntry(jobId, staffId, "work");
  revalidatePath("/field-board");
}
