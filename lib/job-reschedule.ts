import { supabase } from "@/lib/supabase";
import { applyJobStatus, sendScheduleNotifications } from "@/lib/job-lifecycle";
import { syncJobToGraph } from "@/lib/graph-connector";
import { noteJobStep } from "@/lib/planner-connector";
import { notifyTech } from "@/lib/tech-notice-send";
import { getMyStaffId } from "@/lib/job-access";
import { jobTab } from "@/lib/job-edit-rules";
import { parseEtLocal } from "@/lib/tz";

// What happens when the office saves a job's time. Shared by the reschedule server actions
// (jobs list, dispatch, assistant) and the /jobs editor. Not a server action: callers check
// the role first.

export type TimeSetOpts = {
  /**
   * The caller is about to move the job to Scheduled through applyJobStatus, which sends the
   * customer the schedule notice (with the new time). Skip it here so they get one, not two.
   */
  skipCustomerNotice?: boolean;
};

/** Tell whoever the job is assigned to (if anyone) that it moved. Best effort. */
async function notifyAssignedTech(jobId: string, kind: "rescheduled" | "cancelled") {
  const { data } = await supabase.from("jobs").select("assigned_staff_id").eq("id", jobId).maybeSingle();
  await notifyTech({
    jobId,
    staffId: (data?.assigned_staff_id as string | null | undefined) ?? null,
    kind,
    actorStaffId: await getMyStaffId(),
  });
}

/**
 * After the office saves a job's time: a "requested" job (web, portal or phone
 * booking, plan visit) now has a time, so it becomes "scheduled" through the
 * lifecycle. That status change sends the customer's schedule notice and syncs
 * Graph and Planner, so the notice is not sent a second time here. Any other open
 * job just gets the usual "you're scheduled" notice for its new time. A finished or
 * cancelled job whose date is corrected for the records gets no customer or tech notice.
 */
export async function afterTimeSet(
  jobId: string,
  previousStatus: string | null,
  moved: boolean,
  opts: TimeSetOpts = {}
): Promise<{ error?: string }> {
  if (jobTab(previousStatus) !== "active") {
    await syncJobToGraph(jobId);
    return {};
  }
  let result: { error?: string } = {};
  let notified = false;
  if (previousStatus === "requested") {
    try {
      // Only from requested: a job finished or cancelled since the read above stays as it is.
      notified = (await applyJobStatus(jobId, "scheduled", { onlyFrom: "requested" })).changed;
    } catch {
      result = { error: "Saved the new time, but couldn't mark the job Scheduled. Set the status on the Jobs list." };
    }
  }
  if (!notified) {
    if (!opts.skipCustomerNotice) await sendScheduleNotifications(jobId);
    await syncJobToGraph(jobId);
    // The Planner card gets the new time as a dated line (and due date) when the time really moved.
    if (moved) await noteJobStep(jobId, "rescheduled");
  }
  await notifyAssignedTech(jobId, "rescheduled");
  return result;
}

/** True when the saved time is not the time the job already had. */
export function timeMoved(before: unknown, next: Date): boolean {
  return typeof before !== "string" || new Date(before).getTime() !== next.getTime();
}

/** Move a job to a New York date and time ("2026-10-22T09:30"). The caller checks the role. */
export async function moveJobToTime(
  jobId: string,
  localDateTime: string,
  opts: TimeSetOpts = {}
): Promise<{ error?: string }> {
  const next = parseEtLocal(localDateTime);
  if (!next) return { error: "Pick a valid date and time." };

  const { data: job, error: readError } = await supabase.from("jobs").select("id, status, scheduled_at").eq("id", jobId).maybeSingle();
  if (readError) return { error: "Couldn't load the job. Try again." };
  if (!job) return { error: "Job not found." };

  const { error } = await supabase.from("jobs").update({ scheduled_at: next.toISOString() }).eq("id", jobId);
  if (error) return { error: "Couldn't save the new time. Try again." };

  return afterTimeSet(jobId, (job.status as string | null) ?? null, timeMoved(job.scheduled_at, next), opts);
}
