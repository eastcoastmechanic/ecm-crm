"use server";

import { revalidatePath } from "next/cache";
import { requireOffice } from "@/lib/require-role";
import { getMyStaffId } from "@/lib/job-access";
import { officePauseJob, officeResumeJob } from "@/lib/time-edit";

type Result = { error?: string };

function read(formData: FormData) {
  return {
    jobId: String(formData.get("job_id") ?? "").trim(),
    staffId: String(formData.get("staff_id") ?? "").trim(),
  };
}

/** Owner/office pauses a tech's running job timer (same helper as the truck card's Pause). Logged in time_edits. */
export async function pauseTechTimer(formData: FormData): Promise<Result> {
  await requireOffice();
  const { jobId, staffId } = read(formData);
  if (!jobId || !staffId) return { error: "Reload the page and try again." };
  const result = await officePauseJob(jobId, staffId, await getMyStaffId());
  if (!result.error) {
    revalidatePath("/jobs");
    revalidatePath("/hours");
  }
  return result;
}

/** Owner/office resumes a tech's paused job timer (same helper as the truck card's Resume). Logged in time_edits. */
export async function resumeTechTimer(formData: FormData): Promise<Result> {
  await requireOffice();
  const { jobId, staffId } = read(formData);
  if (!jobId || !staffId) return { error: "Reload the page and try again." };
  const result = await officeResumeJob(jobId, staffId, await getMyStaffId());
  if (!result.error) {
    revalidatePath("/jobs");
    revalidatePath("/hours");
  }
  return result;
}
