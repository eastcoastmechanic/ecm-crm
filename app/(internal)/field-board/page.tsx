import Link from "next/link";
import { FIELD_BOT_INSTRUCTIONS, fieldBoardSecretStatus, getFieldBoardSheet } from "@/lib/field-board";
import { buttonSecondaryClass, headingClass, itemSubClass, itemTitleClass, subTextClass } from "../ui";
import FieldNoteForm from "./FieldNoteForm";
import JobStatusButtons from "./JobStatusButtons";

export const dynamic = "force-dynamic";

type BoardJob = {
  id: string;
  status: string;
  scheduled_at: string | null;
  notes: string | null;
  customer: string | null;
  address: string | null;
};

function stamp(value: string | null) {
  if (!value) return "unscheduled";
  return new Date(value).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function FieldBoardPage() {
  const secrets = fieldBoardSecretStatus();
  let sheetError: string | null = null;
  const sheet = await getFieldBoardSheet().catch((err: unknown) => {
    sheetError = err instanceof Error ? err.message : "Field sheet failed";
    return {
      generated_at: null as string | null,
      today_key: null as string | null,
      today: [] as BoardJob[],
      needs_attention: [] as BoardJob[],
      active: [] as BoardJob[],
      ongoing: [] as BoardJob[],
      jobs: [] as BoardJob[],
      events: [] as { id: string; title: string; body: string | null; board_status: string | null; source: string; created_at: string }[],
      tasks: [] as { id: string; title: string; due_at: string | null; board_column?: string }[],
    };
  });

  const tableMissing = Boolean(sheetError && /field_board_events/i.test(sheetError));
  const todayJobs = sheet.today ?? [];
  const needsAttention = sheet.needs_attention ?? [];
  const active = sheet.active ?? [];
  const ongoing = sheet.ongoing ?? [];
  const events = sheet.events ?? [];
  const tasks = sheet.tasks ?? [];
  const openJobs = [...active, ...todayJobs, ...needsAttention, ...ongoing];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className={headingClass}>Today's board</h1>
          <p className={subTextClass}>
            Truck first. CRM hub. Morning sheet only — no invented jobs.
            {sheet.today_key ? ` ${sheet.today_key}` : ""}
          </p>
        </div>
        <Link href="/jobs" className={buttonSecondaryClass}>
          Jobs list
        </Link>
      </div>

      {!secrets.field_board_secret && (
        <p className="text-sm text-accent">
          FIELD_BOARD_SECRET is not on this production deploy. Add it in Vercel for Production, then Redeploy.
        </p>
      )}
      {tableMissing && (
        <p className="text-sm text-accent">
          Field events table is not live yet. Run db/migrations/0041_field_board_events.sql in Supabase.
        </p>
      )}
      {sheetError && !tableMissing && <p className="text-sm text-accent">{sheetError}</p>}

      <BoardColumn title="Today's board" empty="Nothing on the morning sheet for today." jobs={todayJobs} />
      <BoardColumn title="Needs Attention" empty="Nothing flagged." jobs={needsAttention} />
      <BoardColumn title="Active" empty="Nothing on site." jobs={active} />
      <BoardColumn title="Ongoing" empty="No open follow-ups." jobs={ongoing} />

      {tasks.length > 0 && (
        <div>
          <h2 className="mb-3 font-display text-lg font-bold">Open tasks</h2>
          <div className="grid gap-3">
            {tasks.map((task) => (
              <div key={task.id} className="rounded-xl border border-white/8 bg-white/3 p-4">
                <div className={itemTitleClass}>{task.title}</div>
                <p className={itemSubClass}>{task.due_at ? stamp(task.due_at) : "No due date"}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-white/8 bg-white/3 p-4">
        <div className={itemTitleClass}>Field note</div>
        <p className={`${itemSubClass} mb-3 mt-1`}>Updates this board first, then writes the CRM event. Does not invent a customer.</p>
        <FieldNoteForm
          jobs={openJobs.map((job) => ({
            id: job.id,
            label: [job.customer, job.address, job.status].filter(Boolean).join(" · ") || job.id.slice(0, 8),
          }))}
        />
      </div>

      <div>
        <h2 className="mb-3 font-display text-lg font-bold">Morning field sheet</h2>
        {!tableMissing && events.length === 0 && <p className={itemSubClass}>No notes yet. Log one above.</p>}
        <div className="grid gap-3">
          {events.map((event) => (
            <div key={event.id} className="rounded-xl border border-white/8 bg-white/3 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className={itemTitleClass}>{event.title}</div>
                <div className="text-[11px] uppercase tracking-wide text-g300">
                  {event.board_status ?? event.source}
                </div>
              </div>
              {event.body && <p className={`${itemSubClass} mt-1 whitespace-pre-wrap`}>{event.body}</p>}
              <div className={`${itemSubClass} mt-2`}>{stamp(event.created_at)}</div>
            </div>
          ))}
        </div>
      </div>

      <details className="rounded-xl border border-white/8 bg-white/3 p-4">
        <summary className="cursor-pointer font-medium text-white">Bot hook (optional)</summary>
        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-g300">{FIELD_BOT_INSTRUCTIONS}</pre>
      </details>
    </div>
  );
}

function BoardColumn({ title, empty, jobs }: { title: string; empty: string; jobs: BoardJob[] }) {
  return (
    <div>
      <h2 className="mb-3 font-display text-lg font-bold">{title}</h2>
      {jobs.length === 0 && <p className={itemSubClass}>{empty}</p>}
      <div className="grid gap-3">
        {jobs.map((job) => (
          <div key={job.id} className="rounded-xl border border-white/8 bg-white/3 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className={itemTitleClass}>{job.customer ?? "Job"}</div>
              <div className="text-[11px] uppercase tracking-wide text-g300">{job.status.replaceAll("_", " ")}</div>
            </div>
            <p className={itemSubClass}>{job.address ?? "No address"}</p>
            <p className={itemSubClass}>{stamp(job.scheduled_at)}</p>
            {job.notes && <p className={`${itemSubClass} mt-2 whitespace-pre-wrap`}>{job.notes}</p>}
            <JobStatusButtons jobId={job.id} status={job.status} />
          </div>
        ))}
      </div>
    </div>
  );
}
