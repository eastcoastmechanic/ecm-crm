import { supabase } from "@/lib/supabase";
import { bearerToken } from "@/lib/bearer-auth";
import { sharedFieldBoardKeyMatches } from "@/lib/bot-keys";
import { CRM_HUB_URL, FIELD_BOARD_URL } from "@/lib/field-board-links";
import { applyJobStatus } from "@/lib/job-lifecycle";
import { listOpenPlannerTasks } from "@/lib/planner-connector";
import { postToTeams } from "@/lib/teams";

export { CRM_HUB_URL, FIELD_BOARD_URL };

export const FIELD_BOT_INSTRUCTIONS = `You are an East Coast Mechanical field bot.
Field Board is first in the truck. CRM is the office hub.
Always open and update the Field Board first: ${FIELD_BOARD_URL}
Use today's morning field sheet on that board.
Then push the same update into CRM so the hub stays current.
Do not invent customers, prices, or job details.
If a CRM job id is known, include it. If it is not known, still log the field note — do not create a fake customer.
crm_status only changes a job when job_id is sent (take it from the CRM sheet). Without job_id the note is logged and the status is left alone.
CRM sheet (read): ${CRM_HUB_URL}/api/field-board/sheet
CRM events (write): ${CRM_HUB_URL}/api/field-board/events
Auth: Authorization: Bearer <this bot's own key from CRM Account → Bot keys>
On site / Active → crm_status in_progress, board_status active
Done / Finished → crm_status complete, board_status finished
`;

const JOB_STATUSES = new Set(["requested", "scheduled", "in_progress", "complete", "cancelled"]);

export function fieldBoardSecretStatus() {
  return {
    field_board_secret: Boolean(process.env.FIELD_BOARD_SECRET),
    field_board_app_key: Boolean(process.env.FIELD_BOARD_APP_KEY),
  };
}

export function fieldBoardAuthorized(request: Request) {
  const token = bearerToken(request);
  if (!token) return false;
  // Only the Field Board's own keys. CRON_SECRET and MCP_API_KEY used to work here
  // too, so a leak of either opened the field API. One secret per surface.
  // tokenMatches fails closed on unset/empty values. Per-bot keys: fieldBoardCaller in lib/bot-keys.ts.
  return sharedFieldBoardKeyMatches(token);
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
  /** Skip matching a job by the customer name in the text. Set for techs, who may only note a job they picked. */
  skip_name_match?: boolean;
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
  // True only when the job is certain: the caller named it by job_id, or this
  // same source already tied this external_ref to it. A match on the customer's
  // name in the text is never certain (two Sullivans, a typo, a note about a
  // neighbour): it may attach the note, but it never changes the job's status.
  confident: boolean;
};

async function resolveJob(input: FieldBoardEventBody, source: string): Promise<ResolvedJob | null> {
  const direct = input.job_id?.trim();
  if (direct) {
    const { data: job } = await supabase.from("jobs").select("id").eq("id", direct).maybeSingle();
    if (job?.id) return { id: job.id, confident: true };
  }

  // Another bot's refs mean nothing here: only this source's earlier event counts.
  // (Today a repeat of source + external_ref is caught as a duplicate before this
  // runs, so in practice a status change needs job_id. Kept so it stays safe if
  // the duplicate rule ever changes.)
  const ref = input.external_ref?.trim();
  if (ref) {
    const { data: prior } = await supabase
      .from("field_board_events")
      .select("job_id")
      .eq("source", source)
      .eq("external_ref", ref)
      .not("job_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (prior?.job_id) return { id: prior.job_id, confident: true };
  }

  if (input.skip_name_match) return null;

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
  // about, so log it unattached instead of guessing. One match gets the note only.
  if (open.length === 1) return { id: open[0].id, confident: false };
  if (open.length === 0 && jobs?.[0]) return { id: jobs[0].id, confident: false };
  return null;
}

// Mirrors a saved field note to the Job Notes channel in Teams so the office and
// the other techs see it without opening the app. Never throws; a Teams problem
// must not fail or retry the note that is already saved.
async function mirrorNoteToTeams(note: {
  jobId: string | null;
  title: string;
  body: string;
  boardStatus: string | null;
}) {
  try {
    let where = "";
    if (note.jobId) {
      const { data: job } = await supabase
        .from("jobs")
        .select("customers(name), properties(address)")
        .eq("id", note.jobId)
        .maybeSingle();
      const customer = Array.isArray(job?.customers) ? job?.customers[0] : job?.customers;
      const property = Array.isArray(job?.properties) ? job?.properties[0] : job?.properties;
      where = [customer?.name, property?.address].filter(Boolean).join(" · ");
    }
    const detail = note.body && note.body !== note.title ? note.body : "";
    await postToTeams("job_notes", {
      title: where ? `${where}: ${note.title}` : note.title,
      text: [note.boardStatus ? `Status: ${note.boardStatus}` : null, detail || null].filter(Boolean).join("\n\n"),
      url: `${CRM_HUB_URL}/field-board`,
    });
  } catch (err) {
    console.error("[field-board] Teams note mirror failed:", err instanceof Error ? err.name : "error");
  }
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

  let resolved = await resolveJob(input, source);
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
  const crmStatus = input.crm_status?.trim();
  // A status asked for without a certain job is not applied. Say so, so a bot can resend with job_id.
  const statusSkipped =
    crmStatus && JOB_STATUSES.has(crmStatus) && !resolved?.confident
      ? "Status not changed: send the CRM job_id to change a job's status."
      : null;
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
      // Only on a certain job (job_id, or this source's own external_ref).
      if (resolved.confident && crmStatus && JOB_STATUSES.has(crmStatus) && crmStatus !== job.status) {
        statusApplied = (await applyJobStatus(job.id, crmStatus)).changed;
      }
    } catch (err) {
      if (noteWritten) {
        // The note is already on the job. Keep the event (and its ref) so a retry
        // is seen as a duplicate instead of appending the note a second time.
        statusError = err instanceof Error ? err.message : "Status change failed";
        await mirrorNoteToTeams({ jobId: job.id, title: title || body.slice(0, 120), body, boardStatus: input.board_status?.trim() || null });
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

  await mirrorNoteToTeams({
    jobId: job?.id ?? null,
    title: title || body.slice(0, 120),
    body,
    boardStatus: input.board_status?.trim() || null,
  });

  return result(event, { status_applied: statusApplied, ...(statusSkipped ? { status_skipped: statusSkipped } : {}) });
}
