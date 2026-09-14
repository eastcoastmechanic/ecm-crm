import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { FIELD_BOARD_URL, FIELD_BOT_INSTRUCTIONS } from "@/lib/field-board";
import { buttonClass, buttonSecondaryClass, headingClass, itemSubClass, itemTitleClass, subTextClass } from "../ui";

export const dynamic = "force-dynamic";

export default async function FieldBoardPage() {
  const { data: events, error } = await supabase
    .from("field_board_events")
    .select("id, source, title, body, board_status, job_id, created_at")
    .order("created_at", { ascending: false })
    .limit(40);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className={headingClass}>Field Board</h1>
          <p className={subTextClass}>
            Truck UI first. Grok bots write the board, then this hub. CRM keeps the record.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={FIELD_BOARD_URL} target="_blank" rel="noreferrer" className={buttonClass}>
            Open Field Board
          </a>
          <Link href="/jobs" className={buttonSecondaryClass}>
            Jobs hub
          </Link>
        </div>
      </div>

      <div className="rounded-xl border border-white/8 bg-white/3 p-4">
        <div className={itemTitleClass}>How the field talks to the office</div>
        <ol className={`${itemSubClass} mt-2 list-decimal space-y-1 pl-5`}>
          <li>Open the Field Board on the phone.</li>
          <li>Tell the Grok bot the update. Bot writes the board first.</li>
          <li>Bot posts the same note to this CRM so jobs and billing stay current.</li>
        </ol>
        <p className={`${itemSubClass} mt-3`}>
          Live board:{" "}
          <a href={FIELD_BOARD_URL} className="text-accent underline" target="_blank" rel="noreferrer">
            {FIELD_BOARD_URL}
          </a>
        </p>
      </div>

      <div>
        <h2 className="mb-3 font-display text-lg font-bold">From the field</h2>
        {error && (
          <p className="text-sm text-accent">
            Field events table is not live yet. Run db/migrations/0041_field_board_events.sql in Supabase,
            then add FIELD_BOARD_SECRET on Vercel.
          </p>
        )}
        {!error && (events ?? []).length === 0 && (
          <p className={itemSubClass}>No field events in the hub yet. First bot or board post lands here.</p>
        )}
        <div className="grid gap-3">
          {(events ?? []).map((event) => (
            <div key={event.id} className="rounded-xl border border-white/8 bg-white/3 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className={itemTitleClass}>{event.title}</div>
                <div className="text-[11px] uppercase tracking-wide text-g300">
                  {event.board_status ?? event.source}
                </div>
              </div>
              {event.body && <p className={`${itemSubClass} mt-1 whitespace-pre-wrap`}>{event.body}</p>}
              <div className={`${itemSubClass} mt-2`}>
                {new Date(event.created_at).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
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
