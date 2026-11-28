/**
 * The owner-only "ECM Daily Rundown" Planner plan.
 *
 * Lives in its own private Microsoft 365 group ("ECM Owner Rundown") with Josh as the
 * only owner and member, never in the "East Coast Mechanical Jobs" group techs may be
 * in, because the cards carry money flags. Planner rosters would avoid the group, but
 * the roster API is beta only (not for production), so a private group it is.
 *
 * App-only Graph (lib/graph-auth.ts). Every PATCH needs a current ETag (Graph answers
 * 412 without one), same as lib/planner-connector.ts. Failures are recorded on the item
 * (push_error) and retried by /api/cron/rundown-sync; they never fail the ingest.
 */
import { GRAPH_BASE, graphConfigured, graphFetch, graphFetchWithRetry } from "@/lib/graph-auth";
import { supabase } from "@/lib/supabase";
import { etDateAtHour } from "@/lib/tz";
import { ITEM_COLUMNS } from "@/lib/rundown";
import {
  RUNDOWN_BUCKETS,
  cardChanges,
  desiredCard,
  planLabelNames,
  pulledStatus,
  pushedAfter,
  sha,
  type PlannerTaskState,
  type PushedCard,
  type RundownBucketId,
  type RundownItemRow,
} from "@/lib/rundown-rules";

export const GROUP_NAME = "ECM Owner Rundown";
export const GROUP_NICKNAME = "ecm-owner-rundown";
export const PLAN_TITLE = "ECM Daily Rundown";

/** Cards written per push. A create is about three Graph calls, so this stays well inside a minute. */
export const PUSH_BATCH = 25;

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://ecm-crm.vercel.app").replace(/\/$/, "");

export type RundownPlannerConfig = {
  owner_user_id: string | null;
  group_id: string | null;
  plan_id: string | null;
  buckets: Partial<Record<RundownBucketId, string>> | null;
  labels_set: boolean;
  last_pull_at: string | null;
  last_error: string | null;
};

export async function loadPlannerConfig(): Promise<RundownPlannerConfig | null> {
  const { data, error } = await supabase
    .from("rundown_planner")
    .select("owner_user_id, group_id, plan_id, buckets, labels_set, last_pull_at, last_error")
    .eq("id", 1)
    .maybeSingle();
  if (error || !data) return null;
  return data as RundownPlannerConfig;
}

function ready(config: RundownPlannerConfig | null): config is RundownPlannerConfig & { plan_id: string } {
  return Boolean(config?.plan_id && RUNDOWN_BUCKETS.every((b) => config.buckets?.[b.id]));
}

async function saveConfig(patch: Partial<RundownPlannerConfig>) {
  const { error } = await supabase
    .from("rundown_planner")
    .upsert({ id: 1, ...patch, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) throw new Error(`couldn't save planner ids: ${error.message}`);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function graphError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const json = JSON.parse(text) as { error?: { code?: string; message?: string } };
    return `${res.status} ${json.error?.code ?? ""} ${json.error?.message ?? ""}`.trim().slice(0, 300);
  } catch {
    return `${res.status} ${text.slice(0, 200)}`;
  }
}

// ---------------------------------------------------------------- setup

export type SetupResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * Makes (or finishes making) the private group, the plan, its buckets and labels.
 * Safe to press again: every step reuses what exists, and ids are saved as each step
 * finishes, so a slow Microsoft side just means "press it again in a minute".
 */
export async function setupRundownPlanner(ownerSignIn: string): Promise<SetupResult> {
  if (!graphConfigured()) return { ok: false, error: "The Microsoft app isn't set up on this site (MS_GRAPH_* settings)." };
  let config = (await loadPlannerConfig()) ?? {
    owner_user_id: null,
    group_id: null,
    plan_id: null,
    buckets: null,
    labels_set: false,
    last_pull_at: null,
    last_error: null,
  };

  try {
    // 1. Josh's Microsoft user.
    let ownerId = config.owner_user_id;
    if (!ownerId) {
      const upn = ownerSignIn.trim();
      if (!upn) return { ok: false, error: "Type the Microsoft sign-in (email) of the owner account." };
      const res = await graphFetch(`/users/${encodeURIComponent(upn)}?$select=id`);
      if (res.status === 404) return { ok: false, error: "No Microsoft account with that sign-in in this tenant." };
      if (res.status === 403) {
        return {
          ok: false,
          error:
            "Microsoft refused to look up the account. The app registration needs the User.Read.All application permission (admin consent) to add you to the new group.",
        };
      }
      if (!res.ok) return { ok: false, error: `Account lookup failed: ${await graphError(res)}` };
      ownerId = ((await res.json()) as { id: string }).id;
      await saveConfig({ owner_user_id: ownerId });
    }

    // 2. The private group (reuse one with our nickname if a press half-finished before).
    let groupId = config.group_id;
    if (!groupId) {
      const find = await graphFetch(`/groups?$filter=${encodeURIComponent(`mailNickname eq '${GROUP_NICKNAME}'`)}&$select=id`);
      if (find.ok) groupId = ((await find.json()) as { value: { id: string }[] }).value[0]?.id ?? null;
      if (!groupId) {
        const userRef = `${GRAPH_BASE}/users/${ownerId}`;
        const res = await graphFetch("/groups", {
          method: "POST",
          body: JSON.stringify({
            displayName: GROUP_NAME,
            description: "Owner only. Daily rundown board from the CRM (money flags). Do not add techs.",
            mailNickname: GROUP_NICKNAME,
            mailEnabled: true,
            securityEnabled: false,
            groupTypes: ["Unified"],
            visibility: "Private",
            "owners@odata.bind": [userRef],
            "members@odata.bind": [userRef],
          }),
        });
        if (!res.ok) return { ok: false, error: `Couldn't make the private group: ${await graphError(res)}` };
        groupId = ((await res.json()) as { id: string }).id;
      }
      await saveConfig({ group_id: groupId });
    }

    // 3. The plan. A brand-new group takes a little while before Planner accepts it.
    let planId = config.plan_id;
    if (!planId) {
      const list = await graphFetch(`/groups/${groupId}/planner/plans`);
      if (list.ok) {
        const plans = ((await list.json()) as { value: { id: string; title: string }[] }).value;
        planId = plans.find((p) => p.title === PLAN_TITLE)?.id ?? null;
      }
      for (let attempt = 0; !planId && attempt < 4; attempt++) {
        if (attempt > 0) await sleep(5_000);
        const res = await graphFetch("/planner/plans", {
          method: "POST",
          body: JSON.stringify({ container: { url: `${GRAPH_BASE}/groups/${groupId}` }, title: PLAN_TITLE }),
        });
        if (res.ok) planId = ((await res.json()) as { id: string }).id;
        else if (attempt === 3) {
          return {
            ok: false,
            error: `Group made, but Microsoft isn't ready for the plan yet (${await graphError(res)}). Press the button again in a minute.`,
          };
        }
      }
      await saveConfig({ plan_id: planId });
      await sleep(2_000); // a new plan can 404 on an immediate bucket create
    }

    // 4. Buckets, left to right.
    const buckets: Partial<Record<RundownBucketId, string>> = { ...(config.buckets ?? {}) };
    if (RUNDOWN_BUCKETS.some((b) => !buckets[b.id])) {
      const list = await graphFetch(`/planner/plans/${planId}/buckets`);
      const existing = list.ok ? ((await list.json()) as { value: { id: string; name: string; orderHint: string }[] }).value : [];
      let lastHint: string | null = null;
      for (const bucket of RUNDOWN_BUCKETS) {
        const found = buckets[bucket.id] ? existing.find((b) => b.id === buckets[bucket.id]) : existing.find((b) => b.name === bucket.name);
        if (found) {
          buckets[bucket.id] = found.id;
          lastHint = found.orderHint;
          continue;
        }
        const res = await graphFetchWithRetry("/planner/buckets", {
          method: "POST",
          body: JSON.stringify({ name: bucket.name, planId, orderHint: lastHint ? `${lastHint} !` : " !" }),
        });
        if (!res.ok) {
          await saveConfig({ buckets });
          return { ok: false, error: `Couldn't make the "${bucket.name}" column: ${await graphError(res)}. Press again.` };
        }
        const created = (await res.json()) as { id: string; orderHint: string };
        buckets[bucket.id] = created.id;
        lastHint = created.orderHint;
      }
      await saveConfig({ buckets });
    }

    // 5. Label names (Urgent, Important, Job, Lead, Text, Email, Money).
    if (!config.labels_set) {
      const details = await graphFetch(`/planner/plans/${planId}/details`);
      const etag = details.headers.get("etag") ?? ((await details.json().catch(() => ({}))) as { "@odata.etag"?: string })["@odata.etag"];
      if (details.ok && etag) {
        const res = await graphFetchWithRetry(`/planner/plans/${planId}/details`, {
          method: "PATCH",
          headers: { "If-Match": etag },
          body: JSON.stringify({ categoryDescriptions: planLabelNames() }),
        });
        if (res.ok) await saveConfig({ labels_set: true });
        else console.error(`[rundown-planner] labels not named: ${res.status}`);
      }
    }

    config = (await loadPlannerConfig()) ?? config;
    await saveConfig({ last_error: null });
    return {
      ok: true,
      message: config.labels_set
        ? "Done. Open Planner (or Teams → Planner) and look for ECM Daily Rundown."
        : "Plan made. Labels didn't name yet; press again to finish.",
    };
  } catch (err) {
    console.error("[rundown-planner] setup failed:", err);
    return { ok: false, error: "Microsoft didn't answer in time. Press the button again." };
  }
}

// ---------------------------------------------------------------- push

type PlanTask = {
  id: string;
  title: string;
  bucketId: string;
  percentComplete: number;
  completedDateTime?: string | null;
  completedBy?: { user?: { id?: string } } | null;
  "@odata.etag": string;
};

/** Every task in the plan, or null if any page failed (then nothing is marked dropped). */
async function listPlanTasks(planId: string): Promise<Map<string, PlanTask> | null> {
  const tasks = new Map<string, PlanTask>();
  let path: string | null = `/planner/plans/${planId}/tasks`;
  for (let page = 0; path && page < 30; page++) {
    const res = await graphFetch(path);
    if (!res.ok) {
      console.error(`[rundown-planner] task list failed: ${res.status}`);
      return null;
    }
    const json = (await res.json()) as { value?: PlanTask[]; "@odata.nextLink"?: string };
    for (const t of json.value ?? []) tasks.set(t.id, t);
    const next = json["@odata.nextLink"];
    path = next ? (next.startsWith(GRAPH_BASE) ? next.slice(GRAPH_BASE.length) : null) : null;
    if (next && !path) return null;
  }
  return path ? null : tasks;
}

function noonEt(due: string | null): string | null {
  return due ? (etDateAtHour(due, 12)?.toISOString() ?? null) : null;
}

type PushRow = RundownItemRow & {
  id: string;
  planner_task_id: string | null;
  planner_pushed: PushedCard | null;
  push_attempts: number;
  updated_at: string;
};

async function setDescription(taskId: string, description: string, onlyIfHash?: string | null): Promise<"ok" | "edited" | "failed"> {
  const res = await graphFetch(`/planner/tasks/${taskId}/details`);
  if (!res.ok) return "failed";
  const json = (await res.json()) as { description?: string | null; "@odata.etag"?: string };
  const etag = res.headers.get("etag") || json["@odata.etag"];
  if (!etag) return "failed";
  if (onlyIfHash !== undefined && onlyIfHash !== null && sha(json.description ?? "") !== onlyIfHash) return "edited";
  const patch = await graphFetchWithRetry(`/planner/tasks/${taskId}/details`, {
    method: "PATCH",
    headers: { "If-Match": etag },
    body: JSON.stringify({ description }),
  });
  return patch.ok ? "ok" : "failed";
}

async function deleteTask(taskId: string) {
  const res = await graphFetch(`/planner/tasks/${taskId}`);
  const etag = res.ok ? res.headers.get("etag") ?? ((await res.json()) as PlanTask)["@odata.etag"] : null;
  if (!etag) return;
  await graphFetchWithRetry(`/planner/tasks/${taskId}`, { method: "DELETE", headers: { "If-Match": etag } }).catch(() => null);
}

const LOST_CLAIM = "__lost_claim__";

/** Writes one item's card. Returns an error string, LOST_CLAIM, or null when the card matches. */
async function pushOne(
  row: PushRow,
  config: RundownPlannerConfig & { plan_id: string },
  tasks: Map<string, PlanTask> | null
): Promise<string | null> {
  const buckets = config.buckets!;
  const desired = desiredCard(row, APP_URL);
  let taskId = row.planner_task_id;
  let pushed = row.planner_pushed;

  // Done before it ever got a card: nothing to show.
  if (!taskId && desired.complete) return null;

  if (!taskId) {
    const res = await graphFetchWithRetry("/planner/tasks", {
      method: "POST",
      body: JSON.stringify({
        planId: config.plan_id,
        bucketId: buckets[desired.bucket],
        title: desired.title,
        dueDateTime: noonEt(desired.due) ?? undefined,
        ...(desired.labels.length > 0 ? { appliedCategories: Object.fromEntries(desired.labels.map((s) => [s, true])) } : {}),
      }),
    });
    if (!res.ok) return `create: ${await graphError(res)}`;
    const newId = ((await res.json()) as { id: string }).id;

    // Claim: only one push may own the card. The loser deletes its copy.
    const { data: claimed, error } = await supabase
      .from("rundown_items")
      .update({ planner_task_id: newId })
      .eq("id", row.id)
      .is("planner_task_id", null)
      .select("id");
    if (error) return `save card id: ${error.message}`;
    if (!claimed || claimed.length === 0) {
      await deleteTask(newId);
      // The other push owns the card. Leave needs_push alone: it may have written an
      // older version of this item, and the next sync compares and writes the rest.
      return LOST_CLAIM;
    }
    taskId = newId;
    const desc = await setDescription(taskId, desired.description);
    pushed = {
      title: desired.title,
      bucket: desired.bucket,
      due: desired.due,
      labels: desired.labels,
      descHash: desc === "ok" ? sha(desired.description) : "",
      complete: false,
    };
    await supabase.from("rundown_items").update({ planner_pushed: pushed }).eq("id", row.id);
    if (desc !== "ok") return "description not written yet";
    return null;
  }

  const current = tasks?.get(taskId) ?? null;
  // A card already complete in Planner counts as complete (never reopened).
  const pushedNow: PushedCard | null = pushed && current && current.percentComplete >= 100 ? { ...pushed, complete: true } : pushed;
  const changes = cardChanges(desired, pushedNow);
  const body: Record<string, unknown> = {};
  if (changes.title !== undefined) body.title = changes.title;
  if (changes.bucket !== undefined) body.bucketId = buckets[changes.bucket];
  if (changes.due !== undefined) body.dueDateTime = noonEt(changes.due);
  if (changes.labels) body.appliedCategories = changes.labels;
  if (changes.complete) body.percentComplete = 100;

  if (Object.keys(body).length > 0) {
    let etag = current?.["@odata.etag"] ?? null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!etag || attempt > 0) {
        const get = await graphFetch(`/planner/tasks/${taskId}`);
        if (get.status === 404) return null; // deleted: the next pull marks it dropped
        if (!get.ok) return `load: ${await graphError(get)}`;
        etag = get.headers.get("etag") ?? ((await get.json()) as PlanTask)["@odata.etag"];
      }
      const res = await graphFetchWithRetry(`/planner/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "If-Match": etag! },
        body: JSON.stringify(body),
      });
      if (res.ok) break;
      if (res.status === 404) return null;
      if (res.status !== 412 || attempt === 1) return `update: ${await graphError(res)}`;
    }
  }

  let applied = changes;
  if (changes.description !== undefined) {
    const result = await setDescription(taskId, changes.description, pushedNow?.descHash || null);
    if (result === "failed") return "description not written";
    if (result === "edited") applied = { ...changes, description: undefined };
  }
  await supabase
    .from("rundown_items")
    .update({ planner_pushed: pushedAfter(desired, pushedNow, applied) })
    .eq("id", row.id);
  return null;
}

export type PushSummary = {
  configured: boolean;
  pulled: { done: number; dropped: number } | null;
  pushed: number;
  failed: number;
  remaining: boolean;
};

/**
 * Reads completions back from Planner, then writes any item that needs it.
 * Never throws. Safe to run twice at once (card creation is claimed per item).
 */
export async function syncRundownPlanner(): Promise<PushSummary> {
  const summary: PushSummary = { configured: false, pulled: null, pushed: 0, failed: 0, remaining: false };
  try {
    const config = await loadPlannerConfig();
    if (!ready(config) || !graphConfigured()) return summary;
    summary.configured = true;

    // 1. Pull: cards Josh completed or deleted.
    const tasks = await listPlanTasks(config.plan_id);
    if (tasks) {
      const states = new Map<string, PlannerTaskState>(
        [...tasks.values()].map((t) => [
          t.id,
          {
            percentComplete: t.percentComplete,
            completedDateTime: t.completedDateTime ?? null,
            completedBy: t.completedBy?.user?.id ?? null,
          },
        ])
      );
      const { data: open } = await supabase
        .from("rundown_items")
        .select("id, status, planner_task_id, planner_pushed")
        .eq("status", "open")
        .not("planner_task_id", "is", null)
        .limit(2000);
      let done = 0;
      let dropped = 0;
      for (const item of open ?? []) {
        const pulled = pulledStatus(item as { status: "open"; planner_task_id: string }, states);
        if (!pulled) continue;
        if (pulled.status === "dropped") {
          // Missing from the list could be a card another push made a moment ago: confirm it's really gone.
          const check = await graphFetch(`/planner/tasks/${item.planner_task_id}`);
          if (check.status !== 404) continue;
        }
        const update =
          pulled.status === "done"
            ? {
                status: "done",
                done_at: pulled.doneAt ?? new Date().toISOString(),
                done_by: pulled.doneBy,
                done_source: "planner",
                planner_pushed: { ...((item.planner_pushed as PushedCard | null) ?? {}), complete: true },
                needs_push: false,
              }
            : { status: "dropped", done_at: new Date().toISOString(), done_source: "planner", needs_push: false };
        // Only if still open: a Grok close in between keeps its own record.
        const { error } = await supabase.from("rundown_items").update(update).eq("id", item.id).eq("status", "open");
        if (error) continue;
        if (pulled.status === "done") done++;
        else dropped++;
      }
      summary.pulled = { done, dropped };
      await saveConfig({ last_pull_at: new Date().toISOString() });
    }

    // 2. Push.
    const { data: rows, error } = await supabase
      .from("rundown_items")
      .select(`id, ${ITEM_COLUMNS}, planner_task_id, planner_pushed, push_attempts, updated_at`)
      .eq("needs_push", true)
      .order("push_attempts")
      .order("updated_at")
      .limit(PUSH_BATCH + 1);
    if (error) throw new Error(error.message);
    summary.remaining = (rows ?? []).length > PUSH_BATCH;

    for (const row of ((rows ?? []) as unknown as PushRow[]).slice(0, PUSH_BATCH)) {
      let problem: string | null;
      try {
        problem = await pushOne(row, config, tasks);
      } catch (err) {
        problem = err instanceof Error ? err.message.slice(0, 300) : "push failed";
      }
      if (problem === LOST_CLAIM) continue;
      if (problem) {
        summary.failed++;
        await supabase
          .from("rundown_items")
          .update({ push_error: problem, push_attempts: row.push_attempts + 1 })
          .eq("id", row.id);
        continue;
      }
      summary.pushed++;
      // Clear the flag only if nothing new arrived while this card was written.
      await supabase
        .from("rundown_items")
        .update({ needs_push: false, push_error: null, push_attempts: 0, pushed_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("updated_at", row.updated_at);
    }
    return summary;
  } catch (err) {
    console.error("[rundown-planner] sync failed:", err);
    await saveConfig({ last_error: "Planner sync failed; the hourly retry will try again." }).catch(() => null);
    return summary;
  }
}
