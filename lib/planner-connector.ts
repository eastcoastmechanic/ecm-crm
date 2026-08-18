/**
 * Reads and writes the East Coast Mechanical "Jobs" Planner plan. This is
 * the CRM's task store now — the AI assistant's add_task/list_open_tasks/
 * complete_task tools call straight in here instead of a Supabase `tasks`
 * table, so a task Copilot creates shows up in Teams/Planner directly with
 * no separate sync step.
 *
 * One plan, six buckets modeling a job's lifecycle:
 *   Tasks (ad hoc, no job) -> Jobs (new/scheduled) -> In Progress ->
 *   Needs Attention (blocked/flagged) -> Finished -> Billed
 *
 * Auth is the same app-only cert-based Graph client as the search
 * connector (lib/graph-auth.ts) — reuses its token cache, just needs
 * Group.ReadWrite.All / Team.Create / Tasks.ReadWrite.All added to the same
 * app registration and admin-consented (the search connector's
 * ExternalConnection.* permissions don't cover Planner).
 *
 * Planner's write API requires an If-Match ETag on every PATCH (task
 * updates and bucket moves) — Graph 412s a PATCH without a current etag, so
 * every mutation here does a GET-for-etag immediately before the PATCH.
 * There's an unavoidable race if two writers touch the same task between
 * the GET and the PATCH, but at this shop's scale (one plan, a handful of
 * people) that's never going to matter in practice.
 */
import { graphConfigured, graphFetch, graphFetchWithRetry } from "@/lib/graph-auth";
import { supabase } from "@/lib/supabase";

export type PlannerBucketName =
  | "tasks"
  | "jobs"
  | "in_progress"
  | "needs_attention"
  | "finished"
  | "billed";

const BUCKET_ENV_KEYS: Record<PlannerBucketName, string> = {
  tasks: "MS_PLANNER_BUCKET_TASKS_ID",
  jobs: "MS_PLANNER_BUCKET_JOBS_ID",
  in_progress: "MS_PLANNER_BUCKET_IN_PROGRESS_ID",
  needs_attention: "MS_PLANNER_BUCKET_NEEDS_ATTENTION_ID",
  finished: "MS_PLANNER_BUCKET_FINISHED_ID",
  billed: "MS_PLANNER_BUCKET_BILLED_ID",
};

export function plannerConfigured(): boolean {
  return graphConfigured() && Boolean(process.env.MS_PLANNER_PLAN_ID) && getBucketId("tasks") !== null;
}

export function getBucketId(bucket: PlannerBucketName): string | null {
  return process.env[BUCKET_ENV_KEYS[bucket]] || null;
}

function getPlanId(): string {
  const planId = process.env.MS_PLANNER_PLAN_ID;
  if (!planId) throw new Error("MS_PLANNER_PLAN_ID not set — run scripts/planner-setup.mjs first");
  return planId;
}

type PlannerTask = {
  id: string;
  title: string;
  bucketId: string;
  percentComplete: number;
  dueDateTime: string | null;
  "@odata.etag": string;
  details?: { description: string | null };
};

export type OpenPlannerTask = {
  id: string;
  title: string;
  notes: string | null;
  dueDateTime: string | null;
  bucketId: string;
};

async function getTaskEtag(taskId: string): Promise<string> {
  const res = await graphFetch(`/planner/tasks/${taskId}`);
  if (!res.ok) throw new Error(`Failed to load task ${taskId} for etag: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as PlannerTask;
  return res.headers.get("etag") || json["@odata.etag"];
}

export async function createPlannerTask(input: {
  title: string;
  notes?: string;
  dueDate?: string; // YYYY-MM-DD
  bucket: PlannerBucketName;
}): Promise<string | null> {
  if (!plannerConfigured()) return null;
  const bucketId = getBucketId(input.bucket);
  if (!bucketId) throw new Error(`Planner bucket "${input.bucket}" not configured`);

  const res = await graphFetchWithRetry("/planner/tasks", {
    method: "POST",
    body: JSON.stringify({
      planId: getPlanId(),
      bucketId,
      title: input.title,
      dueDateTime: input.dueDate ? new Date(`${input.dueDate}T12:00:00`).toISOString() : undefined,
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to create Planner task: ${res.status} ${await res.text()}`);
  }
  const task = (await res.json()) as PlannerTask;

  if (input.notes) {
    // Description text lives in a separate plannerTaskDetails resource with
    // its own etag -- Graph rejects "*" here (400), unlike some other
    // resources, so this needs a real GET-for-etag first even though we
    // just created the task ourselves.
    const detailsGetRes = await graphFetch(`/planner/tasks/${task.id}/details`);
    const detailsEtag = detailsGetRes.headers.get("etag");
    if (detailsGetRes.ok && detailsEtag) {
      const detailsRes = await graphFetchWithRetry(`/planner/tasks/${task.id}/details`, {
        method: "PATCH",
        headers: { "If-Match": detailsEtag },
        body: JSON.stringify({ description: input.notes }),
      });
      if (!detailsRes.ok) {
        console.error(`[planner] failed to set details for task ${task.id}: ${detailsRes.status} ${await detailsRes.text()}`);
      }
    } else {
      console.error(`[planner] failed to load details etag for task ${task.id}: ${detailsGetRes.status}`);
    }
  }

  return task.id;
}

export async function listOpenPlannerTasks(): Promise<OpenPlannerTask[]> {
  if (!plannerConfigured()) return [];
  // $expand=details pulls each task's description in the same request --
  // otherwise it lives in a separate plannerTaskDetails resource and would
  // need one extra GET per task.
  const res = await graphFetch(`/planner/plans/${getPlanId()}/tasks?$expand=details`);
  if (!res.ok) throw new Error(`Failed to list Planner tasks: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { value: PlannerTask[] };
  return json.value
    .filter((t) => t.percentComplete < 100)
    .sort((a, b) => (a.dueDateTime ?? "9999").localeCompare(b.dueDateTime ?? "9999"))
    .map((t) => ({
      id: t.id,
      title: t.title,
      notes: t.details?.description || null,
      dueDateTime: t.dueDateTime,
      bucketId: t.bucketId,
    }));
}

export async function completePlannerTask(taskId: string): Promise<boolean> {
  if (!plannerConfigured()) return false;
  const etag = await getTaskEtag(taskId);
  const res = await graphFetchWithRetry(`/planner/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "If-Match": etag },
    body: JSON.stringify({ percentComplete: 100 }),
  });
  if (!res.ok) {
    console.error(`[planner] failed to complete task ${taskId}: ${res.status} ${await res.text()}`);
    return false;
  }
  return true;
}

export async function movePlannerTaskToBucket(taskId: string, bucket: PlannerBucketName): Promise<boolean> {
  if (!plannerConfigured()) return false;
  const bucketId = getBucketId(bucket);
  if (!bucketId) throw new Error(`Planner bucket "${bucket}" not configured`);

  const etag = await getTaskEtag(taskId);
  const res = await graphFetchWithRetry(`/planner/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "If-Match": etag },
    body: JSON.stringify({ bucketId }),
  });
  if (!res.ok) {
    console.error(`[planner] failed to move task ${taskId} to bucket ${bucket}: ${res.status} ${await res.text()}`);
    return false;
  }
  return true;
}

/**
 * Keeps a job's card in the "Jobs" plan in step with its status. Creates the
 * card on first use (bucket "jobs") and stores its id on the job row so
 * later calls move the same card instead of creating a new one each time.
 *
 * "complete" splits into needs_attention vs finished depending on whether a
 * diagnostics row exists yet -- a completed job with no QC reading is exactly
 * the "blocked/flagged" case the needs_attention bucket exists for.
 *
 * Mirrors syncJobToGraph's contract: never throws, so a Planner/Graph hiccup
 * never breaks a status update for whoever's standing in front of a customer.
 */
export async function syncJobToPlanner(jobId: string, status: string): Promise<boolean> {
  if (!plannerConfigured()) return true;

  try {
    const { data: job } = await supabase
      .from("jobs")
      .select("planner_task_id, scheduled_at, customers(name), properties(address)")
      .eq("id", jobId)
      .single();
    if (!job) return true;

    let taskId = job.planner_task_id as string | null;

    if (!taskId) {
      const customer = job.customers as unknown as { name: string | null } | null;
      const property = job.properties as unknown as { address: string | null } | null;
      const title = [customer?.name, property?.address].filter(Boolean).join(" — ") || "Job";

      taskId = await createPlannerTask({
        title,
        dueDate: job.scheduled_at ? job.scheduled_at.slice(0, 10) : undefined,
        bucket: "jobs",
      });
      if (!taskId) return true; // Planner not configured — nothing more to do
      await supabase.from("jobs").update({ planner_task_id: taskId }).eq("id", jobId);
    }

    if (status === "cancelled") {
      await completePlannerTask(taskId);
      return true;
    }
    if (status === "in_progress") {
      await movePlannerTaskToBucket(taskId, "in_progress");
      return true;
    }
    if (status === "complete") {
      const { count } = await supabase
        .from("diagnostics")
        .select("id", { count: "exact", head: true })
        .eq("job_id", jobId);
      await movePlannerTaskToBucket(taskId, count && count > 0 ? "finished" : "needs_attention");
    }
    // requested / scheduled: the card was just created (or already exists) in
    // the "jobs" bucket -- nothing more to do.
    return true;
  } catch (err) {
    console.error(`[planner] job sync failed for ${jobId}:`, err);
    return false;
  }
}

/**
 * Moves a job's existing Planner card by job id rather than task id -- for
 * callers (invoice paid, invoice overdue) that know which job a document
 * belongs to but don't otherwise touch Planner. No-ops quietly if the job
 * has no card yet (nothing created via syncJobToPlanner) instead of making
 * one, since creating a card here would put it straight into whichever
 * bucket the caller asked for, skipping the "jobs" bucket every card is
 * meant to start in.
 */
export async function movePlannerTaskForJob(jobId: string, bucket: PlannerBucketName): Promise<boolean> {
  if (!plannerConfigured()) return true;

  try {
    const { data: job } = await supabase.from("jobs").select("planner_task_id").eq("id", jobId).single();
    if (!job?.planner_task_id) return true;
    return await movePlannerTaskToBucket(job.planner_task_id, bucket);
  } catch (err) {
    console.error(`[planner] move-by-job failed for ${jobId}:`, err);
    return false;
  }
}
