import { supabase } from "@/lib/supabase";
import { CRM_HUB_URL, FIELD_BOARD_URL } from "@/lib/field-board-links";

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
`;

const JOB_STATUSES = new Set(["requested", "scheduled", "in_progress", "complete", "cancelled"]);
const TZ = "America/New_York";

export function fieldBoardSecretStatus() {
  return {
    field_board_secret: Boolean(process.env.FIELD_BOARD_SECRET),
    cron_secret: Boolean(process.env.CRON_SECRET),
    mcp_key: Boolean(process.env.MCP_API_KEY),
  };
}

export function fieldBoardAuthorized(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return false;
  const secrets = [process.env.FIELD_BOARD_SECRET, process.env.CRON_SECRET, process.env.MCP_API_KEY].filter(
    (value): value is string => Boolean(value)
  );
  return secrets.includes(token);
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

function nyDateKey(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-CA", { timeZone: TZ });
}

function todayKey() {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}

export type BoardJob = {
  id: string;
  status: string;
  scheduled_at: string | null;
  notes: string | null;
  job_type: string | null;
  customer: string | null;
  address: string | null;
  crm_href: string;
  board_column: "today" | "needs_attention" | "active" | "ongoing" | "finished";
};

function classifyJob(job: Omit<BoardJob, "board_column">, today: string): BoardJob["board_column"] {
  if (job.status === "complete") return "finished";
  if (job.status === "in_progress") return "active";
  const day = nyDateKey(job.scheduled_at);
  if (day === today) return "today";
  if (job.status === "requested" || (day && day < today)) return "needs_attention";
  return "ongoing";
}

export async function getFieldBoardSheet() {
  const today = todayKey();
  const [{ data: jobs }, { data: tasks }, { data: events }] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, status, scheduled_at, notes, job_type, customers(name), properties(address)")
      .not("status", "eq", "cancelled")
      .order("scheduled_at", { ascending: false })
      .limit(50),
    supabase
      .from("tasks")
      .select("id, title, notes, due_at, completed_at, job_id")
      .is("completed_at", null)
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(50),
    supabase.from("field_board_events").select("*").order("created_at", { ascending: false }).limit(30),
  ]);

  const mappedJobs: BoardJob[] = (jobs ?? []).map((job) => {
    const base = {
      id: job.id,
      status: job.status,
      scheduled_at: job.scheduled_at,
      notes: job.notes,
      job_type: job.job_type ?? null,
      customer: relatedName(job.customers as RelatedName),
      address: relatedAddress(job.properties as RelatedAddress),
      crm_href: `${CRM_HUB_URL}/jobs`,
    };
    return { ...base, board_column: classifyJob(base, today) };
  });

  const openTasks = (tasks ?? []).map((task) => {
    const day = nyDateKey(task.due_at);
    let board_column: "today" | "needs_attention" | "ongoing" = "ongoing";
    if (day === today) board_column = "today";
    else if (day && day < today) board_column = "needs_attention";
    return { ...task, board_column };
  });

  return {
    generated_at: new Date().toISOString(),
    timezone: TZ,
    today_key: today,
    field_board_url: FIELD_BOARD_URL,
    crm_url: CRM_HUB_URL,
    today: mappedJobs.filter((job) => job.board_column === "today"),
    needs_attention: mappedJobs.filter((job) => job.board_column === "needs_attention"),
    active: mappedJobs.filter((job) => job.board_column === "active"),
    ongoing: mappedJobs.filter((job) => job.board_column === "ongoing"),
    jobs: mappedJobs,
    tasks: openTasks,
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

export async function ingestFieldBoardEvent(input: FieldBoardEventBody) {
  const title = input.title?.trim();
  const body = input.body?.trim() ?? "";
  if (!title && !body) {
    return { ok: false as const, status: 400, error: "title or body is required" };
  }

  let jobId: string | null = input.job_id?.trim() || null;
  if (jobId) {
    const { data: job } = await supabase.from("jobs").select("id, notes, status").eq("id", jobId).maybeSingle();
    if (!job) {
      jobId = null;
    } else {
      const stamp = new Date().toISOString();
      const line = `[Field Board ${stamp}] ${input.board_status ? `${input.board_status} · ` : ""}${title ?? body}`;
      const nextNotes = [job.notes, line, body && body !== title ? body : null].filter(Boolean).join("\n");
      const crmStatus = input.crm_status?.trim();
      const nextStatus = crmStatus && JOB_STATUSES.has(crmStatus) ? crmStatus : job.status;
      await supabase.from("jobs").update({ notes: nextNotes, status: nextStatus }).eq("id", job.id);
    }
  }

  const { data: event, error } = await supabase
    .from("field_board_events")
    .insert({
      source: (input.source?.trim() || "field-board").slice(0, 80),
      title: title || body.slice(0, 120),
      body: body || title,
      board_status: input.board_status?.trim() || null,
      job_id: jobId,
      external_ref: input.external_ref?.trim() || null,
    })
    .select("id, job_id")
    .single();

  if (error || !event) {
    return { ok: false as const, status: 500, error: error?.message ?? "Failed to store field event" };
  }

  return {
    ok: true as const,
    event_id: event.id,
    job_id: event.job_id,
    field_board_url: FIELD_BOARD_URL,
    crm_job_href: event.job_id ? `${CRM_HUB_URL}/jobs` : null,
  };
}
