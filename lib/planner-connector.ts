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
import { GRAPH_BASE, graphConfigured, graphFetch, graphFetchWithRetry } from "@/lib/graph-auth";
import { supabase } from "@/lib/supabase";
import { etDateAtHour, etDateKey } from "@/lib/tz";
import {
  appendNoteLine,
  finishedBucket,
  jobSourceLabel,
  LEAD_LABEL,
  leadCardNotes,
  leadCardTitle,
  leadSourceLabel,
  leadStageClosesCard,
  leadStageText,
  missingCategoryNames,
  planCategories,
  STEP_BUCKET,
  statusToStep,
  stepCreatesCard,
  stepLine,
  stepText,
  type JobStep,
  type PlannerBucketName,
} from "@/lib/planner-steps";

export type { JobStep, PlannerBucketName } from "@/lib/planner-steps";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://ecm-crm.vercel.app").replace(/\/$/, "");

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

async function getTask(taskId: string): Promise<{ etag: string; bucketId: string; percentComplete: number }> {
  const res = await graphFetch(`/planner/tasks/${taskId}`);
  if (!res.ok) throw new Error(`Failed to load task ${taskId} for etag: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as PlannerTask;
  return {
    etag: res.headers.get("etag") || json["@odata.etag"],
    bucketId: json.bucketId,
    percentComplete: json.percentComplete,
  };
}

async function getTaskEtag(taskId: string): Promise<string> {
  return (await getTask(taskId)).etag;
}

/** Noon New York time on the due day, so Planner shows the same date in ET. */
function dueDateTime(dueDate: string | undefined | null): string | undefined {
  return dueDate ? etDateAtHour(dueDate.slice(0, 10), 12)?.toISOString() : undefined;
}

export async function createPlannerTask(input: {
  title: string;
  notes?: string;
  dueDate?: string; // YYYY-MM-DD
  bucket: PlannerBucketName;
  /** Label slots ("category3") from plannerLabels. */
  categories?: string[];
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
      dueDateTime: dueDateTime(input.dueDate),
      ...(input.categories && input.categories.length > 0
        ? { appliedCategories: Object.fromEntries(input.categories.map((c) => [c, true])) }
        : {}),
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

/**
 * Same as listOpenPlannerTasks, but a Planner/Graph outage returns an error
 * message instead of throwing, so pages that show tasks (Tasks, Jobs) keep working.
 */
export async function listOpenPlannerTasksSafe(): Promise<{ tasks: OpenPlannerTask[]; error: string | null }> {
  try {
    return { tasks: await listOpenPlannerTasks(), error: null };
  } catch (err) {
    console.error("Planner task list failed:", err);
    return { tasks: [], error: "Couldn't load tasks from Planner right now. Try again in a minute." };
  }
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
  return patchPlannerTask(taskId, { bucket });
}

/**
 * Move a card and/or change its due date in one PATCH. Skips the PATCH when the card is
 * already in that bucket and no due date is given.
 */
async function patchPlannerTask(
  taskId: string,
  change: { bucket?: PlannerBucketName | null; dueDate?: string | null; percentComplete?: number }
): Promise<boolean> {
  if (!plannerConfigured()) return false;
  const bucketId = change.bucket ? getBucketId(change.bucket) : null;
  if (change.bucket && !bucketId) throw new Error(`Planner bucket "${change.bucket}" not configured`);

  const task = await getTask(taskId);
  const body: Record<string, unknown> = {};
  if (bucketId && task.bucketId !== bucketId) body.bucketId = bucketId;
  const due = dueDateTime(change.dueDate);
  if (due) body.dueDateTime = due;
  if (change.percentComplete !== undefined && task.percentComplete !== change.percentComplete) {
    body.percentComplete = change.percentComplete;
  }
  if (Object.keys(body).length === 0) return true;

  const res = await graphFetchWithRetry(`/planner/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "If-Match": task.etag },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`[planner] failed to update task ${taskId}: ${res.status} ${await res.text()}`);
    return false;
  }
  return true;
}

/** Delete a card (used when two callers raced to make the same card; the loser removes its copy). */
async function deletePlannerTask(taskId: string): Promise<void> {
  try {
    const etag = await getTaskEtag(taskId);
    const res = await graphFetchWithRetry(`/planner/tasks/${taskId}`, { method: "DELETE", headers: { "If-Match": etag } });
    if (!res.ok) console.error(`[planner] failed to delete duplicate task ${taskId}: ${res.status}`);
  } catch (err) {
    console.error(`[planner] failed to delete duplicate task ${taskId}:`, err);
  }
}

/**
 * Add one line to the end of a card's notes. Notes live in plannerTaskDetails with their own
 * ETag, so this reads them first. The oldest dated lines are dropped if the notes get near
 * Planner's size limit (appendNoteLine).
 */
async function appendPlannerTaskNote(taskId: string, line: string): Promise<boolean> {
  const res = await graphFetch(`/planner/tasks/${taskId}/details`);
  if (!res.ok) {
    console.error(`[planner] failed to load notes for task ${taskId}: ${res.status}`);
    return false;
  }
  const json = (await res.json()) as { description?: string | null; "@odata.etag"?: string };
  const etag = res.headers.get("etag") || json["@odata.etag"];
  if (!etag) {
    console.error(`[planner] no etag on notes for task ${taskId}`);
    return false;
  }
  const patch = await graphFetchWithRetry(`/planner/tasks/${taskId}/details`, {
    method: "PATCH",
    headers: { "If-Match": etag },
    body: JSON.stringify({ description: appendNoteLine(json.description, line) }),
  });
  if (!patch.ok) {
    console.error(`[planner] failed to add a note to task ${taskId}: ${patch.status} ${await patch.text()}`);
    return false;
  }
  return true;
}

/** Slots (category1..25) applied on any card in the plan, or null if they can't be read. */
async function usedCategorySlots(planId: string): Promise<Set<string> | null> {
  const used = new Set<string>();
  let path: string | null = `/planner/plans/${planId}/tasks`;
  for (let page = 0; path && page < 20; page++) {
    const res = await graphFetch(path);
    if (!res.ok) {
      console.error(`[planner] failed to list tasks for labels: ${res.status}`);
      return null;
    }
    const json = (await res.json()) as {
      value?: { appliedCategories?: Record<string, boolean> }[];
      "@odata.nextLink"?: string;
    };
    for (const t of json.value ?? []) {
      for (const [slot, on] of Object.entries(t.appliedCategories ?? {})) if (on) used.add(slot);
    }
    const next = json["@odata.nextLink"];
    path = next ? (next.startsWith(GRAPH_BASE) ? next.slice(GRAPH_BASE.length) : null) : null;
    if (next && !path) return null;
  }
  return path ? null : used;
}

/**
 * The plan's label slots for these names. Names that already exist on the plan are
 * reused (case does not matter). A missing name is given a slot that has no name and is
 * on no card; a named slot is never renamed. Any failure just means fewer labels.
 */
export async function plannerLabels(names: string[]): Promise<string[]> {
  if (!plannerConfigured()) return [];
  try {
    const planId = getPlanId();
    const res = await graphFetch(`/planner/plans/${planId}/details`);
    if (!res.ok) {
      console.error(`[planner] failed to read plan labels: ${res.status}`);
      return [];
    }
    const json = (await res.json()) as {
      categoryDescriptions?: Record<string, string | null>;
      "@odata.etag"?: string;
    };
    const etag = res.headers.get("etag") || json["@odata.etag"];
    const descriptions = json.categoryDescriptions ?? {};

    const needNew = missingCategoryNames(descriptions, names).length > 0;
    const used = needNew ? await usedCategorySlots(planId) : new Set<string>();
    // Can't tell which colours are in use: only reuse existing names, never claim a slot.
    const usable = used ? names : names.filter((n) => missingCategoryNames(descriptions, [n]).length === 0);
    const { applied, newNames } = planCategories(descriptions, used ?? new Set(), usable);
    if (Object.keys(newNames).length === 0) return applied;

    const patch = etag
      ? await graphFetchWithRetry(`/planner/plans/${planId}/details`, {
          method: "PATCH",
          headers: { "If-Match": etag },
          body: JSON.stringify({ categoryDescriptions: newNames }),
        })
      : null;
    if (!patch?.ok) {
      console.error(`[planner] failed to name new labels: ${patch?.status ?? "no etag"}`);
      return applied.filter((slot) => !(slot in newNames));
    }
    return applied;
  } catch (err) {
    console.error("[planner] label lookup failed:", err);
    return [];
  }
}

type JobCardRow = {
  planner_task_id: string | null;
  scheduled_at: string | null;
  created_via?: string | null;
  notes?: string | null;
  assigned_staff_id?: string | null;
  customers: unknown;
  properties: unknown;
};

/** Notes a new job card starts with: the CRM link, plus where the request came from for a web/phone lead. */
function jobCardHeader(job: JobCardRow, source: string | null): string {
  const lines: string[] = [];
  if (source) {
    lines.push(`Source: ${source}`);
    const request = (job.notes ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
    if (request) lines.push(`Request: ${request}`);
  }
  lines.push(`Open in CRM: ${APP_URL}/jobs`);
  return lines.join("\n");
}

async function staffName(staffId: string | null | undefined): Promise<string | null> {
  if (!staffId) return null;
  const { data } = await supabase.from("staff").select("name").eq("id", staffId).maybeSingle();
  const name = ((data?.name as string | null | undefined) ?? "").trim();
  return name ? name.split(/\s+/)[0] : null;
}

const TECH_STEPS = new Set<JobStep>(["scheduled", "rescheduled", "on_way", "on_site", "paused", "finished"]);

/**
 * The one place a job's card is made, moved and written to. Never throws: a Planner or
 * Graph problem is logged and the user's action carries on.
 *
 * - No card yet: made in "jobs" (only for steps that may make one) with the CRM link and,
 *   for a web/portal/phone/text request, a "Lead" label plus its source. The id is saved
 *   only where the job still has none; if another call saved one first, this copy is
 *   deleted and the line goes on the winner's card, so a job never gets two cards.
 * - The card moves to the step's bucket (requested/scheduled only on a real change, so a
 *   card the office moved by hand isn't dragged back by a report save).
 * - `note`: a dated New York line for the step goes at the end of the notes.
 */
async function runJobStep(
  jobId: string,
  step: JobStep | null,
  opts: { note: boolean; at?: string | null; staffId?: string | null; docNumber?: string | null }
): Promise<boolean> {
  if (!plannerConfigured()) return true;

  try {
    const { data: job } = await supabase
      .from("jobs")
      .select("planner_task_id, scheduled_at, created_via, notes, assigned_staff_id, customers(name), properties(address)")
      .eq("id", jobId)
      .single();
    if (!job) return true;
    const row = job as unknown as JobCardRow;

    const line =
      opts.note && step
        ? stepLine(
            opts.at ?? new Date(),
            stepText(step, {
              tech: TECH_STEPS.has(step) ? await staffName(opts.staffId ?? row.assigned_staff_id) : null,
              scheduledAt: ["requested", "scheduled", "rescheduled"].includes(step) ? row.scheduled_at : null,
              docNumber: opts.docNumber,
              source:
                step === "requested"
                  ? jobSourceLabel(row.created_via) ?? (row.created_via === "maintenance_plan" ? "maintenance plan" : null)
                  : null,
            })
          )
        : null;

    let taskId = row.planner_task_id;
    let lineWritten = false;

    if (!taskId) {
      if (step && !stepCreatesCard(step)) return true;
      const customer = row.customers as { name: string | null } | null;
      const property = row.properties as { address: string | null } | null;
      const title = [customer?.name, property?.address].filter(Boolean).join(" — ") || "Job";
      const source = jobSourceLabel(row.created_via);
      const header = jobCardHeader(row, source);

      const newId = await createPlannerTask({
        title,
        notes: line ? appendNoteLine(header, line) : header,
        // The New York day of the job (an evening job is already the next day in UTC).
        dueDate: row.scheduled_at ? etDateKey(new Date(row.scheduled_at)) : undefined,
        bucket: "jobs",
        categories: source ? await plannerLabels([LEAD_LABEL, source]) : undefined,
      });
      if (!newId) return true; // Planner not configured — nothing more to do

      const { data: claimed, error: claimError } = await supabase
        .from("jobs")
        .update({ planner_task_id: newId })
        .eq("id", jobId)
        .is("planner_task_id", null)
        .select("id");
      if (!claimError && (!claimed || claimed.length === 0)) {
        // Another call made the card first: keep theirs.
        await deletePlannerTask(newId);
        const { data: winner } = await supabase.from("jobs").select("planner_task_id").eq("id", jobId).single();
        taskId = (winner?.planner_task_id as string | null | undefined) ?? null;
        if (!taskId) return true;
      } else {
        if (claimError) console.error(`[planner] couldn't save card id on job ${jobId}: ${claimError.message}`);
        taskId = newId;
        lineWritten = true;
      }
    }

    if (step === "cancelled") {
      await completePlannerTask(taskId);
    } else if (step) {
      let bucket = STEP_BUCKET[step];
      if (step === "finished") {
        const { count } = await supabase
          .from("diagnostics")
          .select("id", { count: "exact", head: true })
          .eq("job_id", jobId);
        bucket = finishedBucket(Boolean(count && count > 0));
      }
      if ((step === "requested" || step === "scheduled") && !opts.note) bucket = null;
      const dueDate =
        (step === "scheduled" || step === "rescheduled") && opts.note && row.scheduled_at
          ? etDateKey(new Date(row.scheduled_at))
          : null;
      if (bucket || dueDate) await patchPlannerTask(taskId, { bucket, dueDate });
    }

    if (line && !lineWritten) await appendPlannerTaskNote(taskId, line);
    return true;
  } catch (err) {
    console.error(`[planner] job sync failed for ${jobId}:`, err);
    return false;
  }
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
 * `note: true` only from a real status change (applyJobStatus after it claimed the change,
 * or a job just created): it adds the dated line for the step. Re-syncs after a report
 * save pass no note, so nothing is logged twice.
 *
 * Mirrors syncJobToGraph's contract: never throws, so a Planner/Graph hiccup
 * never breaks a status update for whoever's standing in front of a customer.
 */
export async function syncJobToPlanner(
  jobId: string,
  status: string,
  opts: { note?: boolean; at?: string | null } = {}
): Promise<boolean> {
  return runJobStep(jobId, statusToStep(status), { note: Boolean(opts.note), at: opts.at });
}

/**
 * A job step that is not a status change (requested on a new booking, on the way, paused,
 * moved to a new time, invoice created / sent / paid): adds the dated line and moves the
 * card if the step has a bucket. Invoice steps, pause and a time change never make a card
 * for a job that has none. Never throws.
 */
export async function noteJobStep(
  jobId: string,
  step: JobStep,
  opts: { at?: string | null; staffId?: string | null; docNumber?: string | null } = {}
): Promise<boolean> {
  return runJobStep(jobId, step, { note: true, ...opts });
}

// ---------------------------------------------------------------- leads

const LEAD_COLUMNS = "id, source, contact_name, phone_number, contact_info, address, town, summary";

function missingLeadColumn(message: string | undefined): boolean {
  return /planner_task_id/.test(message ?? "");
}

/**
 * A new lead gets a card in the "tasks" bucket: "Lead: <name> — <need>", labelled "Lead"
 * and its source, with what is on file (not the phone number or email itself), the
 * address, the message and a link to /leads. One card per lead: the id is saved on the
 * lead (SQL 0079) and a repeat call does nothing. Before SQL 0079 the card is still made,
 * just not linked. Never throws.
 */
export async function createLeadCard(leadId: string): Promise<boolean> {
  if (!plannerConfigured()) return true;
  try {
    let linkable = true;
    let { data: lead, error } = await supabase
      .from("leads")
      .select(`${LEAD_COLUMNS}, planner_task_id`)
      .eq("id", leadId)
      .maybeSingle();
    if (error && missingLeadColumn(error.message)) {
      linkable = false;
      ({ data: lead, error } = await supabase.from("leads").select(LEAD_COLUMNS).eq("id", leadId).maybeSingle());
    }
    if (error) throw new Error(error.message);
    if (!lead) return true;
    const row = lead as Record<string, string | null>;
    if (row.planner_task_id) return true;

    const contact = row.contact_info ?? "";
    const taskId = await createPlannerTask({
      title: leadCardTitle(row.contact_name, row.summary),
      notes: appendNoteLine(
        leadCardNotes({
          source: row.source,
          phone: row.phone_number,
          email: contact.includes("@") ? contact : null,
          address: row.address,
          town: row.town,
          message: row.summary,
          crmUrl: `${APP_URL}/leads`,
        }),
        stepLine(new Date(), "Lead added")
      ),
      bucket: "tasks",
      categories: await plannerLabels([LEAD_LABEL, leadSourceLabel(row.source)]),
    });
    if (!taskId || !linkable) return true;

    const { data: claimed, error: claimError } = await supabase
      .from("leads")
      .update({ planner_task_id: taskId })
      .eq("id", leadId)
      .is("planner_task_id", null)
      .select("id");
    if (claimError) {
      console.error(`[planner] couldn't save card id on lead ${leadId}: ${claimError.message}`);
    } else if (!claimed || claimed.length === 0) {
      await deletePlannerTask(taskId); // another call made the card first
    }
    return true;
  } catch (err) {
    console.error(`[planner] lead card failed for ${leadId}:`, err);
    return false;
  }
}

/**
 * A lead moved stage: a dated "Stage: Won" line on its card; won, lost and dismissed mark
 * the card complete, any other stage reopens it. No card (or no SQL 0079) does nothing.
 * Call only when the stage really changed. Never throws.
 */
export async function noteLeadStage(leadId: string, status: string): Promise<boolean> {
  if (!plannerConfigured()) return true;
  try {
    const { data, error } = await supabase.from("leads").select("planner_task_id").eq("id", leadId).maybeSingle();
    if (error || !data?.planner_task_id) return true;
    const taskId = data.planner_task_id as string;
    await appendPlannerTaskNote(taskId, stepLine(new Date(), leadStageText(status)));
    await patchPlannerTask(taskId, { percentComplete: leadStageClosesCard(status) ? 100 : 0 });
    return true;
  } catch (err) {
    console.error(`[planner] lead stage note failed for ${leadId}:`, err);
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
