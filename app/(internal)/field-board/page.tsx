import Link from "next/link";
import { FIELD_BOARD_URL, FIELD_BOT_INSTRUCTIONS, fieldBoardSecretStatus, getFieldBoardSheet } from "@/lib/field-board";
import { buttonClass, buttonSecondaryClass, headingClass, itemSubClass, itemTitleClass, subTextClass } from "../ui";
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

const DAY = [
  { n: "1", title: "Morning", body: "Read Next. That is the stop." },
  { n: "2", title: "On site", body: "Tap it when you roll up." },
  { n: "3", title: "Done", body: "Tap it when you leave." },
  { n: "4", title: "Note", body: "Hold, collect, or a fact. Then stop." },
];

function stamp(value: string | null) {
  if (!value) return "unscheduled";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function section(jobs: BoardJob[], statuses: string[]) {
  return jobs.filter((job) => statuses.includes(job.status));
}

function lastLine(notes: string | null) {
  if (!notes) return null;
  const line = notes
    .split("\n")
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1);
  if (!line) return null;
  return line.length > 140 ? `${line.slice(0, 137)}...` : line;
}

function mapsHref(address: string | null) {
  if (!address) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function asBoardJobs(jobs: unknown): BoardJob[] {
  if (!Array.isArray(jobs)) return [];
  return jobs.flatMap((job) => {
    if (!job || typeof job !== "object") return [];
    const row = job as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.status !== "string") return [];
    return [
      {
        id: row.id,
        status: row.status,
        scheduled_at: typeof row.scheduled_at === "string" ? row.scheduled_at : null,
        notes: typeof row.notes === "string" ? row.notes : null,
        customer: typeof row.customer === "string" ? row.customer : null,
        address: typeof row.address === "string" ? row.address : null,
      },
    ];
  });
}

export default async function FieldBoardPage() {
  const secrets = fieldBoardSecretStatus();
  let sheetError: string | null = null;
  const sheet = await getFieldBoardSheet().catch((err: unknown) => {
    sheetError = err instanceof Error ? err.message : "Field sheet failed";
    return {
      jobs: [] as BoardJob[],
      events: [] as {
        id: string;
        title: string;
        body: string | null;
        board_status: string | null;
        source: string;
        created_at: string;
      }[],
      tasks: [] as { id: string; title: string; due_at: string | null }[],
    };
  });

  const tableMissing = Boolean(sheetError && /field_board_events/i.test(sheetError));
  const jobs = asBoardJobs(sheet.jobs);
  const events = (sheet.events ?? []).slice(0, 6);
  const active = section(jobs, ["in_progress"]);
  const queued = section(jobs, ["requested", "scheduled"]);
  const done = section(jobs, ["complete", "completed"]).slice(0, 6);
  const next = active[0] ?? queued[0] ?? null;
  const openJobs = [...active, ...queued];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className={headingClass}>Today</h1>
          <p className={subTextClass}>Same four steps in the truck and for every Grok bot.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={FIELD_BOARD_URL} className={buttonClass}>
            Truck board
          </a>
          <Link href="/field-board/print" className={buttonSecondaryClass}>
            Print sheet
          </Link>
        </div>
      </div>

      <ol className="grid gap-2 sm:grid-cols-4">
        {DAY.map((step) => (
          <li key={step.n} className="rounded-xl border border-white/8 bg-white/3 p-3">
            <div className="text-[11px] font-bold uppercase tracking-wide text-g300">{step.n} {step.title}</div>
            <p className={`${itemSubClass} mt-1`}>{step.body}</p>
          </li>
        ))}
      </ol>

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

      <div className="rounded-xl border border-white/15 bg-white/5 p-4">
        <div className="text-[11px] font-bold uppercase tracking-wide text-g300">Next</div>
        {next ? (
          <JobCard job={next} />
        ) : (
          <p className={`${itemSubClass} mt-2`}>No open CRM job. Do not invent one.</p>
        )}
      </div>

      <BoardColumn title="On site" empty="Nobody on site." jobs={active} />
      <BoardColumn title="Needs" empty="Nothing waiting." jobs={queued} />

      <div className="rounded-xl border border-white/8 bg-white/3 p-4">
        <div className={itemTitleClass}>Note</div>
        <p className={`${itemSubClass} mb-3 mt-1`}>Hold, collect, or a fact. It writes this board and the job.</p>
        <FieldNoteForm
          jobs={openJobs.map((job) => ({
            id: job.id,
            label: [job.customer, job.address].filter(Boolean).join(" · ") || job.id.slice(0, 8),
          }))}
        />
      </div>

      <div>
        <h2 className="mb-3 font-display text-lg font-bold">Latest</h2>
        {!tableMissing && events.length === 0 && <p className={itemSubClass}>No notes yet.</p>}
        <div className="grid gap-3">
          {events.map((event) => (
            <div key={event.id} className="rounded-xl border border-white/8 bg-white/3 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className={itemTitleClass}>{event.title}</div>
                <div className="text-[11px] uppercase tracking-wide text-g300">
                  {event.board_status ?? event.source}
                </div>
              </div>
              <div className={`${itemSubClass} mt-2`}>{stamp(event.created_at)}</div>
            </div>
          ))}
        </div>
      </div>

      {done.length > 0 && (
        <div>
          <h2 className="mb-3 font-display text-lg font-bold">Done</h2>
          <div className="grid gap-3">
            {done.map((job) => (
              <div key={job.id} className="rounded-xl border border-white/8 bg-white/3 p-4">
                <div className={itemTitleClass}>{job.customer ?? "Job"}</div>
                <p className={itemSubClass}>{job.address ?? "No address"}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <details className="rounded-xl border border-white/8 bg-white/3 p-4">
        <summary className="cursor-pointer font-medium text-white">Bot steps</summary>
        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-g300">{FIELD_BOT_INSTRUCTIONS}</pre>
      </details>
    </div>
  );
}

function JobCard({ job }: { job: BoardJob }) {
  const map = mapsHref(job.address);
  const note = lastLine(job.notes);
  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className={itemTitleClass}>{job.customer ?? "Job"}</div>
        <div className="text-[11px] uppercase tracking-wide text-g300">{job.status.replaceAll("_", " ")}</div>
      </div>
      <p className={itemSubClass}>{job.address ?? "No address"}</p>
      <p className={itemSubClass}>{stamp(job.scheduled_at)}</p>
      {note && <p className={`${itemSubClass} mt-2`}>{note}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <JobStatusButtons jobId={job.id} status={job.status} />
        {map && (
          <a href={map} className={buttonSecondaryClass}>
            Maps
          </a>
        )}
      </div>
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
            <JobCard job={job} />
          </div>
        ))}
      </div>
    </div>
  );
}
