import Link from "next/link";
import { FIELD_BOARD_URL, FIELD_BOT_INSTRUCTIONS, fieldBoardSecretStatus, getFieldBoardSheet } from "@/lib/field-board";
import { buttonClass, buttonSecondaryClass, headingClass, itemSubClass, itemTitleClass, subTextClass } from "../ui";
import FieldNoteForm from "./FieldNoteForm";

export const dynamic = "force-dynamic";

function stamp(value: string | null) {
  if (!value) return "unscheduled";
  return new Date(value).toLocaleString("en-US", {
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
    return { jobs: [], events: [], tasks: [] as { id: string; title: string; due_at: string | null }[] };
  });

  const tableMissing = Boolean(sheetError && /field_board_events/i.test(sheetError));
  const jobs = sheet.jobs ?? [];
  const events = sheet.events ?? [];
  const openJobs = jobs.filter((job) => job.status !== "complete");

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className={headingClass}>Field Board</h1>
          <p className={subTextClass}>
            Live CRM sheet. Jobs here update when staff or a Grok bot posts a field note.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={FIELD_BOARD_URL} target="_blank" rel="noreferrer" className={buttonClass}>
            Truck board
          </a>
          <Link href="/jobs" className={buttonSecondaryClass}>
            Jobs hub
          </Link>
        </div>
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

      <div className="rounded-xl border border-white/8 bg-white/3 p-4">
        <div className={itemTitleClass}>Log a field note</div>
        <p className={`${itemSubClass} mb-3 mt-1`}>Writes the CRM hub. Does not invent a customer.</p>
        <FieldNoteForm
          jobs={openJobs.map((job) => ({
            id: job.id,
            label: [job.customer, job.address, job.status].filter(Boolean).join(" · ") || job.id.slice(0, 8),
          }))}
        />
      </div>

      <div>
        <h2 className="mb-3 font-display text-lg font-bold">Open jobs</h2>
        {openJobs.length === 0 && <p className={itemSubClass}>No open CRM jobs on the sheet.</p>}
        <div className="grid gap-3">
          {openJobs.map((job) => (
            <div key={job.id} className="rounded-xl border border-white/8 bg-white/3 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className={itemTitleClass}>{job.customer ?? "Job"}</div>
                <div className="text-[11px] uppercase tracking-wide text-g300">{job.status}</div>
              </div>
              <p className={itemSubClass}>{job.address ?? "No address"}</p>
              <p className={itemSubClass}>{stamp(job.scheduled_at)}</p>
              {job.notes && <p className={`${itemSubClass} mt-2 whitespace-pre-wrap`}>{job.notes}</p>}
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="mb-3 font-display text-lg font-bold">From the field</h2>
        {!tableMissing && events.length === 0 && (
          <p className={itemSubClass}>No field events yet. Log a note above or have a bot POST to /api/field-board/events.</p>
        )}
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
              <div className={`${itemSubClass} mt-2`}>
                {stamp(event.created_at)}
                {event.job_id ? (
                  <>
                    {" · "}
                    <Link href="/jobs" className="text-accent">
                      Jobs hub
                    </Link>
                  </>
                ) : (
                  " · no CRM job linked"
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <details className="rounded-xl border border-white/8 bg-white/3 p-4">
        <summary className="cursor-pointer font-medium text-white">Paste this into every Grok bot</summary>
        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-g300">{FIELD_BOT_INSTRUCTIONS}</pre>
      </details>
    </div>
  );
}
