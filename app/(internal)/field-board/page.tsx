import { headers } from "next/headers";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { createPortalServerClient } from "@/lib/supabase-portal/server";
import ClockBar from "./ClockBar";
import PushButton from "./PushButton";
import { finishBlockers } from "@/lib/checklist-rules";
import { ensureChecklists, loadChecklists, unlockedJobIds } from "@/lib/job-checklist";
import { formatEtTime } from "@/lib/tz";
import { getClockState, getFinishedWeek } from "@/lib/time-clock";
import { FIELD_BOT_INSTRUCTIONS, fieldBoardSecretStatus, getFieldBoardSheet } from "@/lib/field-board";
import { buttonClass, buttonSecondaryClass, headingClass, itemSubClass, itemTitleClass, subTextClass } from "../ui";
import FieldNoteForm from "./FieldNoteForm";
import TruckJobCard, { OnSite, type TruckJob } from "./TruckJobCard";
import OfflineSync from "./OfflineSync";

export const dynamic = "force-dynamic";

const TZ = "America/New_York";

function etDate(value: Date | string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function stamp(value: string | null) {
  if (!value) return "unscheduled";
  return new Date(value).toLocaleString("en-US", {
    timeZone: TZ,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type CustomerRel = { name: string | null; phone?: string | null; notes?: string | null };
type RelatedName = CustomerRel | CustomerRel[] | null;
type PropertyRel = { address: string | null; access_notes?: string | null };
type RelatedAddress = PropertyRel | PropertyRel[] | null;

function countPhotos(photos: unknown): TruckJob["photoCounts"] {
  const counts = { arrival: 0, during: 0, completion: 0 };
  if (!Array.isArray(photos)) return counts;
  for (const photo of photos) {
    const phase = (photo as { phase?: string } | null)?.phase;
    if (phase === "arrival" || phase === "during" || phase === "completion") counts[phase] += 1;
  }
  return counts;
}

function one<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

/** The signed-in staff member's id, so their assigned jobs can lead the list. Null for the shared owner login. */
async function getMyStaffId(): Promise<string | null> {
  try {
    const authClient = await createPortalServerClient();
    const {
      data: { user },
    } = await authClient.auth.getUser();
    if (!user) return null;
    const { data } = await supabase.from("staff").select("id").eq("auth_user_id", user.id).maybeSingle();
    return (data?.id as string | undefined) ?? null;
  } catch {
    return null;
  }
}

async function getTruckJobs(myStaffId: string | null): Promise<TruckJob[]> {
  const now = Date.now();
  const from = new Date(now - 36 * 3600000).toISOString();
  const to = new Date(now + 8 * 24 * 3600000).toISOString();

  const { data } = await supabase
    .from("jobs")
    .select(
      "id, status, scheduled_at, notes, job_type, on_way_at, arrived_at, completed_at, photos, assigned_staff_id, property_id, diagnostics(id), install_reports(id), customers(name, phone, notes), properties(address, access_notes)"
    )
    // Every job that isn't finished or cancelled (so the tech can pick any of them),
    // plus anything scheduled in the recent/upcoming window.
    .or(`status.neq.complete,and(scheduled_at.gte.${from},scheduled_at.lte.${to})`)
    .neq("status", "cancelled")
    .order("scheduled_at", { ascending: true, nullsFirst: false })
    .limit(150);

  // Equipment on file and the last finished visit, per property. No prices:
  // this feeds the tech's phone screen.
  const propertyIds = [...new Set((data ?? []).map((r) => r.property_id as string | null).filter((v): v is string => !!v))];
  const equipmentByProperty = new Map<string, TruckJob["equipment"]>();
  const lastVisitByProperty = new Map<string, string>();
  if (propertyIds.length) {
    const [{ data: equipmentRows }, { data: visitRows }] = await Promise.all([
      supabase
        .from("equipment")
        .select("property_id, type, brand, model, serial_number, install_date")
        .in("property_id", propertyIds),
      supabase
        .from("jobs")
        .select("property_id, completed_at")
        .in("property_id", propertyIds)
        .eq("status", "complete")
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: false }),
    ]);
    for (const e of equipmentRows ?? []) {
      const list = equipmentByProperty.get(e.property_id as string) ?? [];
      list.push({
        type: (e.type as string | null) ?? null,
        brand: (e.brand as string | null) ?? null,
        model: (e.model as string | null) ?? null,
        serial: (e.serial_number as string | null) ?? null,
        installDate: (e.install_date as string | null) ?? null,
      });
      equipmentByProperty.set(e.property_id as string, list);
    }
    for (const v of visitRows ?? []) {
      const key = v.property_id as string;
      if (!lastVisitByProperty.has(key)) lastVisitByProperty.set(key, v.completed_at as string);
    }
  }

  return (data ?? []).map((row) => {
    const customer = one(row.customers as RelatedName);
    const property = one(row.properties as RelatedAddress);
    return {
      id: row.id as string,
      status: row.status as string,
      scheduled_at: (row.scheduled_at as string | null) ?? null,
      notes: (row.notes as string | null) ?? null,
      job_type: (row.job_type as string | null) ?? null,
      on_way_at: (row.on_way_at as string | null) ?? null,
      customer: customer?.name ?? null,
      phone: customer?.phone ?? null,
      address: property?.address ?? null,
      photoCounts: countPhotos(row.photos),
      photoTotal: Array.isArray(row.photos) ? row.photos.length : 0,
      arrived_at: (row.arrived_at as string | null) ?? null,
      completed_at: (row.completed_at as string | null) ?? null,
      assignedToMe: myStaffId !== null && row.assigned_staff_id === myStaffId,
      reportId: ((row.diagnostics as { id: string }[] | null) ?? [])[0]?.id ?? null,
      installReportId: ((row.install_reports as { id: string }[] | null) ?? [])[0]?.id ?? null,
      accessNotes: property?.access_notes ?? null,
      customerNotes: customer?.notes ?? null,
      equipment: row.property_id ? (equipmentByProperty.get(row.property_id as string) ?? []) : [],
      // Only for jobs still open, so a finished job never reports itself as the last visit.
      lastVisit:
        row.property_id && row.status !== "complete"
          ? (lastVisitByProperty.get(row.property_id as string) ?? null)
          : null,
    };
  });
}

export default async function FieldBoardPage() {
  const staffRole = (await headers()).get("x-staff-role");
  const isTech = staffRole === "tech";
  const isOwner = staffRole === "owner";
  const secrets = fieldBoardSecretStatus();
  const myStaffId = getMyStaffId();
  const [sheetResult, rawJobs, myId] = await Promise.all([
    getFieldBoardSheet()
      .then((sheet) => ({ events: sheet.events ?? [], error: null as string | null }))
      .catch((err: unknown) => ({
        events: [] as {
          id: string;
          title: string;
          body: string | null;
          board_status: string | null;
          source: string;
          created_at: string;
        }[],
        error: err instanceof Error ? err.message : "Field sheet failed",
      })),
    myStaffId.then((id) => getTruckJobs(id)),
    myStaffId,
  ]);
  // Time clock: my day shift, and which of my jobs have a running or paused timer.
  // Plus my finished hours this Monday-to-Sunday week (same week as payroll) for the today and week totals.
  const [clock, finishedWeek] = myId
    ? await Promise.all([getClockState(myId).catch(() => null), getFinishedWeek(myId).catch(() => null)])
    : [null, null];
  // Checklists: give each open job its list the first time it shows, then work out what blocks Finish.
  const openJobs = rawJobs.filter((job) => job.status !== "complete");
  await ensureChecklists(openJobs.map((job) => ({ id: job.id, job_type: job.job_type })));
  const [checklists, unlocks] = await Promise.all([
    loadChecklists(openJobs.map((job) => job.id)),
    unlockedJobIds(openJobs.map((job) => job.id)),
  ]);
  const allJobs = rawJobs.map((job) => ({
    ...job,
    checklist: checklists.get(job.id) ?? [],
    unlocked: unlocks.has(job.id),
    blockers:
      job.status === "complete"
        ? []
        : finishBlockers({
            items: checklists.get(job.id) ?? [],
            photoCount: job.photoTotal ?? 0,
            unlocked: unlocks.has(job.id),
          }),
    timer:
      clock?.openEntry?.jobId === job.id && clock.openEntry.kind === "work"
        ? ("running" as const)
        : clock?.pausedJobIds.includes(job.id)
          ? ("paused" as const)
          : null,
  }));
  const sheetError = sheetResult.error;

  const tableMissing = Boolean(sheetError && /field_board_events/i.test(sheetError));
  // Techs see a plain line; the real error goes to the server log.
  if (tableMissing) console.error("[field-board] field_board_events not readable (SQL 0041?):", sheetError);
  const events = sheetResult.events.slice(0, 8);

  const today = etDate(new Date());
  const isToday = (job: TruckJob) =>
    job.status === "in_progress" || (job.scheduled_at !== null && etDate(job.scheduled_at) === today);

  const todays = allJobs.filter(isToday);
  const open = todays
    .filter((job) => job.status !== "complete")
    // On-site job first, then the run order by scheduled time.
    // then jobs assigned to the signed-in tech. sort() is stable, so run order is kept within each group.
    .sort(
      (a, b) =>
        Number(b.status === "in_progress") - Number(a.status === "in_progress") ||
        Number(!!b.assignedToMe) - Number(!!a.assignedToMe)
    );
  const done = todays.filter((job) => job.status === "complete");
  const next = open[0] ?? null;
  const rest = open.slice(1);
  // Every other open job (any date, or unscheduled), to pick from the full list.
  const otherJobs = allJobs
    .filter((job) => !isToday(job) && job.status !== "complete")
    .sort((a, b) => Number(!!b.assignedToMe) - Number(!!a.assignedToMe));
  const noteJobs = [...open, ...otherJobs];

  return (
    <div className="flex flex-col gap-6">
      {myId && (
        <ClockBar
          shiftStartedAt={clock?.shiftStartedAt ?? null}
          sinceLabel={clock?.shiftStartedAt ? formatEtTime(clock.shiftStartedAt) : null}
          finishedWeek={finishedWeek}
        />
      )}
      {myId && <PushButton />}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className={headingClass}>Today</h1>
          <p className={subTextClass}>
            {new Date().toLocaleDateString("en-US", {
              timeZone: TZ,
              weekday: "long",
              month: "short",
              day: "numeric",
            })}
            {" · "}
            {open.length} left{done.length > 0 ? ` · ${done.length} done` : ""}
          </p>
        </div>
        {!isTech && (
          <div className="flex flex-wrap gap-2">
            <Link href="/field-board/print" className={buttonClass}>
              Print sheet
            </Link>
            <a href="/field-board/print/pdf" className={buttonSecondaryClass}>
              PDF
            </a>
            <Link href="/jobs" className={buttonSecondaryClass}>
              Jobs list
            </Link>
          </div>
        )}
      </div>
      <OfflineSync staffKey={myId ?? "none"} renderedAt={new Date().toISOString()} />

      {!isTech && !secrets.field_board_secret && (
        <p className="text-sm text-accent">
          FIELD_BOARD_SECRET is not on this production deploy. Add it in Vercel for Production, then Redeploy.
        </p>
      )}
      {tableMissing && (
        <p className="text-sm text-accent">This part isn&apos;t set up yet — tell the office.</p>
      )}

      {next ? (
        <div>
          <h2 className="mb-3 font-display text-lg font-bold">
            {next.status === "in_progress" ? "On site now" : "Next up"}
          </h2>
          <TruckJobCard job={next} primary canUnlock={isOwner} />
        </div>
      ) : (
        <p className={itemSubClass}>
          {done.length > 0 ? "All done for today." : "Nothing scheduled for today."}
        </p>
      )}

      {rest.length > 0 && (
        <div>
          <h2 className="mb-3 font-display text-lg font-bold">Rest of today</h2>
          <div className="grid gap-3">
            {rest.map((job) => (
              <TruckJobCard key={job.id} job={job} canUnlock={isOwner} />
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-white/8 bg-white/3 p-4">
        <div className={itemTitleClass}>Field note</div>
        <p className={`${itemSubClass} mb-3 mt-1`}>Lands on this board and on the job. Does not invent a customer.</p>
        <FieldNoteForm
          jobs={noteJobs.map((job) => ({
            id: job.id,
            label: [job.customer, job.address, job.status.replaceAll("_", " ")].filter(Boolean).join(" · ") || job.id.slice(0, 8),
          }))}
        />
      </div>

      {otherJobs.length > 0 && (
        <details className="rounded-xl border border-white/8 bg-white/3 p-4">
          <summary className="cursor-pointer font-medium text-white">All jobs ({otherJobs.length})</summary>
          <p className={`${itemSubClass} mt-2`}>Tap a job to open it.</p>
          <div className="mt-3 grid gap-2">
            {otherJobs.map((job) => (
              <details key={job.id} className="rounded-xl border border-white/8 bg-white/3">
                <summary className="flex cursor-pointer items-baseline justify-between gap-3 px-3 py-3">
                  <span className={itemTitleClass}>{job.customer ?? "Job"}</span>
                  <span className={itemSubClass}>{stamp(job.scheduled_at)}</span>
                </summary>
                <div className="px-3 pb-3">
                  <TruckJobCard job={job} canUnlock={isOwner} />
                </div>
              </details>
            ))}
          </div>
        </details>
      )}

      {done.length > 0 && (
        <details className="rounded-xl border border-white/8 bg-white/3 p-4">
          <summary className="cursor-pointer font-medium text-white">Done today ({done.length})</summary>
          <div className="mt-3 grid gap-2">
            {done.map((job) => (
              <div key={job.id}>
                <div className={itemTitleClass}>{job.customer ?? "Job"}</div>
                <p className={itemSubClass}>{job.address ?? "No address"}</p>
                <OnSite job={job} />
              </div>
            ))}
          </div>
        </details>
      )}

      <details className="rounded-xl border border-white/8 bg-white/3 p-4">
        <summary className="cursor-pointer font-medium text-white">From the field ({events.length})</summary>
        <div className="mt-3 grid gap-3">
          {!tableMissing && events.length === 0 && <p className={itemSubClass}>No notes yet.</p>}
          {events.map((event) => (
            <div key={event.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className={itemTitleClass}>{event.title}</div>
                <div className="text-[11px] uppercase tracking-wide text-g300">
                  {event.board_status ?? event.source}
                </div>
              </div>
              {event.body && <p className={`${itemSubClass} mt-1 whitespace-pre-wrap`}>{event.body}</p>}
              <div className={itemSubClass}>{stamp(event.created_at)}</div>
            </div>
          ))}
        </div>
      </details>

      {!isTech && (
        <details className="rounded-xl border border-white/8 bg-white/3 p-4">
          <summary className="cursor-pointer font-medium text-white">Bot hook (optional)</summary>
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-g300">{FIELD_BOT_INSTRUCTIONS}</pre>
        </details>
      )}
    </div>
  );
}
