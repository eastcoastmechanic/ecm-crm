import { supabase } from "@/lib/supabase";
import { bearerToken, tokenMatches } from "@/lib/bearer-auth";
import { CRM_HUB_URL, FIELD_BOARD_URL } from "@/lib/field-board-links";
import { applyJobStatus } from "@/lib/job-lifecycle";
import { listOpenPlannerTasks } from "@/lib/planner-connector";

export { CRM_HUB_URL, FIELD_BOARD_URL };

export const FIELD_BOT_INSTRUCTIONS = `You are an East Coast Mechanical field bot.
Field Board is first in the truck. CRM is the office hub.
Always open and update the Field Board first: ${FIELD_BOARD_URL}
Use today's morning field sheet on that board.
Then push the same update into CRM so the hub stays current.
Do not invent customers, prices, or job details.
If a CRM job id is known, include it. If it is not known, still log the field note — do not create a fake customer.
CRM sheet (read): ${CRM_HUB_URL}/api/field-board/sheet
CRM events (write): ${CRM_HUB_URL}/api/field-board/events
Auth: Authorization: Bearer <FIELD_BOARD_SECRET>
On site / Active → crm_status in_progress, board_status active
Done / Finished → crm_status complete, board_status finished
`;

const JOB_STATUSES = new Set(["requested", "scheduled", "in_progress", "complete", "cancelled"]);

export function fieldBoardSecretStatus() {
  return {
    field_board_secret: Boolean(process.env.FIELD_BOARD_SECRET),
    field_board_app_key: Boolean(process.env.FIELD_BOARD_APP_KEY),
    cron_secret: Boolean(process.env.CRON_SECRET),
    mcp_key: Boolean(process.env.MCP_API_KEY),
  };
}

export function fieldBoardAuthorized(request: Request) {
  const token = bearerToken(request);
  if (!token) return false;
  const secrets = [
    process.env.FIELD_BOARD_SECRET,
    process.env.FIELD_BOARD_APP_KEY,
    process.env.CRON_SECRET,
    process.env.MCP_API_KEY,
  ];
  // Check every secret (no early exit) so timing does not reveal which matched.
  // tokenMatches fails closed on unset/empty values.
  return secrets.reduce((ok, secret) => tokenMatches(token, secret) || ok, false);
}

type RelatedName = { name: string | null } | { name: string | null }[] | null;
type RelatedAddress = { address: string | null } | { address: string | null }[] | null;

function relatedName(value: RelatedName) {
  if (!value) return null;
  return Array.isArray(value) ? value[0]?.name ?? null : value.name;
}

function relatedAddress(value: RelatedAddress) {
  if (!value) return null;
  return Array.isArray(value) ? value[0]?.address ?? null : value.address;
}

export async function getFieldBoardSheet() {
  // Tasks live in Planner now (the old `tasks` table is dead). If Planner is
  // unreachable the sheet still renders with no tasks.
  const plannerTasks = listOpenPlannerTasks().catch((err) => {
    console.error("[field-board] Planner tasks unavailable:", err);
    return [];
  });

  const [{ data: jobs }, tasks, { data: events }] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, status, scheduled_at, notes, job_type, customers(name), properties(address)")
      .not("status", "eq", "cancelled")
      .order("scheduled_at", { ascending: false })
      .limit(50),
    plannerTasks,
    supabase.from("field_board_events").select("*").order("created_at", { ascending: false }).limit(30),
  ]);

  return {
    field_board_url: FIELD_BOARD_URL,
    crm_url: CRM_HUB_URL,
    jobs: (jobs ?? []).map((job) => ({
      id: job.id,
      status: job.status,
      scheduled_at: job.scheduled_at,
      notes: job.notes,
      job_type: job.job_type ?? null,
      customer: relatedName(job.customers as RelatedName),
      address: relatedAddress(job.properties as RelatedAddress),
      crm_href: `${CRM_HUB_URL}/jobs`,
    })),
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      notes: task.notes,
      due_at: task.dueDateTime,
      completed_at: null as string | null,
      job_id: null as string | null,
    })),
    events: events ?? [],
  };
}

export type FieldBoardEventBody = {
  source?: string;
  title?: string;
  body?: string;
  board_status?: string;
  job_id?: string;
  external_ref?: string;
  crm_status?: string;
};

function searchToken(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((part) => part.length >= 4 && !/^(this|that|from|with|hold|open|done|job|install|service)$/.test(part));
}

type ResolvedJob = {
  id: string;
  // True when the job is certain: the caller named it, or this external_ref was
  // already matched to it, or the fuzzy match left exactly one open job.
  // Status only changes on a confident match.
  confident: boolean;
};

async function resolveJob(input: FieldBoardEventBody): Promise<ResolvedJob | null> {
  const direct = input.job_id?.trim();
  if (direct) {
    const { data: job } = await supabase.from("jobs").select("id").eq("id", direct).maybeSingle();
    if (job?.id) return { id: job.id, confident: true };
  }

  const ref = input.external_ref?.trim();
  if (ref) {
    const { data: prior } = await supabase
      .from("field_board_events")
      .select("job_id")
      .eq("external_ref", ref)
      .not("job_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (prior?.job_id) return { id: prior.job_id, confident: true };
  }

  const haystack = `${input.title ?? ""} ${input.body ?? ""}`;
  const tokens = searchToken(haystack);
  if (tokens.length === 0) return null;

  // Tokens are lowercase alphanumerics (see searchToken), safe to put in a filter.
  const { data: customers } = await supabase
    .from("customers")
    .select("id, name")
    .or(tokens.map((token) => `name.ilike.%${token}%`).join(","))
    .order("name")
    .limit(5);
  if ((customers ?? []).length !== 1) return null;

  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, status")
    .eq("customer_id", customers![0].id)
    .not("status", "eq", "cancelled")
    .order("scheduled_at", { ascending: false, nullsFirst: false })
    .limit(10);
  const open = (jobs ?? []).filter((job) => job.status !== "complete");
  // Several open jobs for this customer: we can't tell which one the note is
  // about, so log it unattached instead of guessing.
  if (open.length === 1) return { id: open[0].id, confident: true };
  if (open.length === 0 && jobs?.[0]) return { id: jobs[0].id, confident: false };
  return null;
}

export async function ingestFieldBoardEvent(input: FieldBoardEventBody) {
  const title = input.title?.trim();
  const body = input.body?.trim() ?? "";
  if (!title && !body) {
    return { ok: false as const, status: 400, error: "title or body is required" };
  }

  const source = (input.source?.trim() || "field-board").slice(0, 80);
  const externalRef = input.external_ref?.trim() || null;

  const result = (event: { id: string; job_id: string | null }, extra: Record<string, unknown> = {}) => ({
    ok: true as const,
    event_id: event.id,
    job_id: event.job_id,
    matched: Boolean(event.job_id),
    field_board_url: FIELD_BOARD_URL,
    crm_job_href: event.job_id ? `${CRM_HUB_URL}/jobs` : null,
    ...extra,
  });

  // A retried POST carries the same source + external_ref: acknowledge it
  // without appending the note or changing status a second time.
  const findDuplicate = async () => {
    if (!externalRef) return null;
    const { data } = await supabase
      .from("field_board_events")
      .select("id, job_id")
      .eq("source", source)
      .eq("external_ref", externalRef)
      .limit(1)
      .maybeSingle();
    return data;
  };
  const existing = await findDuplicate();
  if (existing) return result(existing, { duplicate: true });

  let resolved = await resolveJob(input);
  let job: { id: string; notes: string | null; status: string } | null = null;
  if (resolved) {
    const { data } = await supabase.from("jobs").select("id, notes, status").eq("id", resolved.id).maybeSingle();
    job = data;
    if (!job) resolved = null;
  }

  // Claim the external_ref first (unique index), then apply side effects, so two
  // concurrent retries can't both write the note.
  const { data: event, error } = await supabase
    .from("field_board_events")
    .insert({
      source,
      title: title || body.slice(0, 120),
      body: body || title,
      board_status: input.board_status?.trim() || null,
      job_id: job?.id ?? null,
      external_ref: externalRef,
    })
    .select("id, job_id")
    .single();

  if (error || !event) {
    if (error?.code === "23505") {
      const dup = await findDuplicate();
      if (dup) return result(dup, { duplicate: true });
    }
    return { ok: false as const, status: 500, error: error?.message ?? "Failed to store field event" };
  }

  let statusApplied = false;
  let statusError: string | null = null;
  if (job && resolved) {
    let noteWritten = false;
    try {
      const stamp = new Date().toISOString();
      const line = `[Field Board ${stamp}] ${input.board_status ? `${input.board_status} · ` : ""}${title ?? body}`;
      const nextNotes = [job.notes, line, body && body !== title ? body : null].filter(Boolean).join("\n");
      const { error: notesError } = await supabase.from("jobs").update({ notes: nextNotes }).eq("id", job.id);
      if (notesError) throw new Error(notesError.message);
      noteWritten = true;

      // Status goes through the same lifecycle as the Jobs page so arrived_at,
      // completed_at, tracked_hours, Planner/Graph sync and notifications run.
      const crmStatus = input.crm_status?.trim();
      if (resolved.confident && crmStatus && JOB_STATUSES.has(crmStatus) && crmStatus !== job.status) {
        await applyJobStatus(job.id, crmStatus);
        statusApplied = true;
      }
    } catch (err) {
      if (noteWritten) {
        // The note is already on the job. Keep the event (and its ref) so a retry
        // is seen as a duplicate instead of appending the note a second time.
        statusError = err instanceof Error ? err.message : "Status change failed";
        return { ...result(event, { status_applied: false }), status_error: statusError };
      }
      // Nothing was written: release the ref so the caller's retry can run it all again.
      await supabase.from("field_board_events").delete().eq("id", event.id);
      return {
        ok: false as const,
        status: 500,
        error: err instanceof Error ? err.message : "Failed to update job from field event",
      };
    }
  }

  return result(event, { status_applied: statusApplied });
}
