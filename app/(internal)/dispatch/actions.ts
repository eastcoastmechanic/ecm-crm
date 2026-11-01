"use server";

import { revalidatePath } from "next/cache";
import { assignJob, rescheduleJobAt } from "../jobs/actions";
import { requireOffice } from "@/lib/require-role";
import { supabase } from "@/lib/supabase";

export type DispatchState = { error?: string; saved?: boolean };

// Dispatch edits go through the existing job actions so customer schedule
// notifications and the Graph sync keep firing. Errors come back inline.
export async function saveDispatchEdit(_prev: DispatchState, formData: FormData): Promise<DispatchState> {
  try {
    await requireOffice();
    const jobId = String(formData.get("job_id") ?? "");
    if (!jobId) return { error: "Job is required" };
    const staffId = String(formData.get("staff_id") ?? "").trim();
    const when = String(formData.get("scheduled_at") ?? "").trim();
    const originalStaff = String(formData.get("original_staff_id") ?? "");
    const originalWhen = String(formData.get("original_scheduled_at") ?? "");

    const { data: job, error: readError } = await supabase.from("jobs").select("id").eq("id", jobId).maybeSingle();
    if (readError) return { error: readError.message };
    if (!job) return { error: "Job not found" };

    if (staffId !== originalStaff) {
      const fd = new FormData();
      fd.set("job_id", jobId);
      fd.set("staff_id", staffId);
      await assignJob(fd);
    }
    if (when && when !== originalWhen) {
      await rescheduleJobAt(jobId, when);
    }
    revalidatePath("/dispatch");
    return { saved: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save" };
  }
}
