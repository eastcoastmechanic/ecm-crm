import Link from "next/link";
import { headers } from "next/headers";
import { supabase } from "@/lib/supabase";
import { buildWeekReport, type EntryRow, type ShiftRow, type StaffRow } from "@/lib/time-report";
import { markTimeReviewed } from "./actions";
import { formatEtDate, formatEtDateTime, formatEtTime, toEtLocalInput } from "@/lib/tz";
import { hoursBetween, paidShiftHours } from "@/lib/time-clock-rules";
import { editNote, type TimeEditAction } from "@/lib/time-edit-rules";
import TimeRowEditor, { type TimeRowView } from "./TimeRowEditor";
import AddTimeForm from "./AddTimeForm";
import { buttonSecondaryClass, headingClass, itemSubClass, itemTitleClass, subTextClass } from "../ui";

export const dynamic = "force-dynamic";

const TZ = "America/New_York";

// Calendar date (YYYY-MM-DD) in ECM's time zone for an instant.
function etDate(d: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
}

function addDays(ymd: string, n: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Midnight at the start of `ymd` in New York, as a UTC instant (DST-safe).
function etMidnightUtc(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hour12: false, hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(guess));
  const h = Number(parts.find((p) => p.type === "hour")!.value) % 24;
  const min = Number(parts.find((p) => p.type === "minute")!.value);
  // At `guess` (00:00 UTC) New York shows (24 - offset) hours; shift back to NY midnight.
  const nyMinutes = h * 60 + min;
  const offsetMin = nyMinutes === 0 ? 0 : nyMinutes - 24 * 60;
  return new Date(guess - offsetMin * 60000);
}

function mondayOf(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sun
  return addDays(ymd, -((dow + 6) % 7));
}

function label(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC", month: "short", day: "numeric",
  });
}

type JobRow = {
  id: string;
  completed_at: string;
  tracked_hours: number | null;
  assigned_staff_id: string | null;
  customers: { name: string | null } | null;
  properties: { address: string | null } | null;
};

export default async function HoursPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  // proxy.ts already keeps techs off this path; this is a second lock because
  // the page shows everyone's hours.
  if ((await headers()).get("x-staff-role") === "tech") {
    return <p className={subTextClass}>Not allowed.</p>;
  }

  const { week } = await searchParams;
  const today = etDate(new Date());
  const start = mondayOf(week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : today);
  const end = addDays(start, 7);

  const fromIso = etMidnightUtc(start).toISOString();
  const toIso = etMidnightUtc(end).toISOString();
  const [{ data: jobs, error }, { data: staff }, { data: shiftRows }, { data: entryRows }, { data: flaggedShifts }, { data: flaggedEntries }] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, completed_at, tracked_hours, assigned_staff_id, customers(name), properties(address)")
      .eq("status", "complete")
      .gte("completed_at", etMidnightUtc(start).toISOString())
      .lt("completed_at", etMidnightUtc(end).toISOString())
      .order("completed_at", { ascending: true }),
    supabase.from("staff").select("id, name, email"),
    // "*" so voided_at / voided_reason (SQL 0078) come back once they exist, and nothing breaks before.
    supabase
      .from("time_shifts")
      .select("*")
      .gte("started_at", fromIso)
      .lt("started_at", toIso)
      .order("started_at", { ascending: true }),
    supabase
      .from("job_time_entries")
      .select("*")
      .gte("started_at", fromIso)
      .lt("started_at", toIso)
      .order("started_at", { ascending: true }),
    // Flags from any week that nobody has looked at yet.
    supabase
      .from("time_shifts")
      .select("id, staff_id, started_at, ended_at, flag_reason")
      .eq("flagged", true)
      .is("reviewed_at", null)
      .order("started_at", { ascending: false })
      .limit(50),
    supabase
      .from("job_time_entries")
      .select("id, staff_id, kind, started_at, ended_at, flag_reason")
      .eq("flagged", true)
      .is("reviewed_at", null)
      .order("started_at", { ascending: false })
      .limit(50),
  ]);

  const report = buildWeekReport((staff ?? []) as StaffRow[], (shiftRows ?? []) as ShiftRow[], (entryRows ?? []) as EntryRow[]);
  type FlagRow = { id: string; staff_id: string; started_at: string; ended_at: string | null; flag_reason: string | null; kind?: string };
  const flags = [
    ...((flaggedShifts ?? []) as FlagRow[]).map((f) => ({ ...f, table: "time_shifts", what: "Day shift" })),
    ...((flaggedEntries ?? []) as FlagRow[]).map((f) => ({ ...f, table: "job_time_entries", what: `Job ${f.kind ?? "time"}` })),
  ].sort((a, b) => b.started_at.localeCompare(a.started_at));

  const names = new Map((staff ?? []).map((s) => [s.id, s.name || s.email]));

  // ---- Time by person: every shift and job timer this week, with Edit / Void / Add missed time ----
  type WeekShift = ShiftRow & { voided_reason?: string | null; flag_reason?: string | null };
  type WeekEntry = EntryRow & { voided_reason?: string | null; flag_reason?: string | null };
  const weekShifts = (shiftRows ?? []) as WeekShift[];
  const weekEntries = (entryRows ?? []) as WeekEntry[];
  const rowIds = [...weekShifts.map((s) => s.id), ...weekEntries.map((e) => e.id)];
  const entryJobIds = [...new Set(weekEntries.map((e) => e.job_id))];
  const [{ data: editRows }, { data: entryJobs }, { data: nearbyJobs }] = await Promise.all([
    // Before SQL 0078 this table is missing: the read fails and rows simply show no edit note.
    rowIds.length
      ? supabase
          .from("time_edits")
          .select("row_id, action, reason, edited_by, created_at")
          .in("row_id", rowIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    entryJobIds.length
      ? supabase.from("jobs").select("id, scheduled_at, customers(name), properties(address)").in("id", entryJobIds)
      : Promise.resolve({ data: [] }),
    // Jobs to pick from in "Add missed time": scheduled from a week before this one to its end.
    supabase
      .from("jobs")
      .select("id, scheduled_at, customers(name), properties(address)")
      .gte("scheduled_at", etMidnightUtc(addDays(start, -7)).toISOString())
      .lt("scheduled_at", toIso)
      .order("scheduled_at", { ascending: false })
      .limit(200),
  ]);
  type PickJob = { id: string; scheduled_at: string | null; customers: { name: string | null } | null; properties: { address: string | null } | null };
  const jobLabel = (j: PickJob) =>
    [j.customers?.name ?? "Customer", j.properties?.address, j.scheduled_at ? formatEtDate(j.scheduled_at) : "no date"]
      .filter(Boolean)
      .join(" · ");
  const jobById = new Map<string, PickJob>();
  for (const j of [...((nearbyJobs ?? []) as unknown as PickJob[]), ...((entryJobs ?? []) as unknown as PickJob[])]) jobById.set(j.id, j);
  const jobChoices = [...jobById.values()].map((j) => ({ id: j.id, label: jobLabel(j) }));

  type EditRow = { row_id: string; action: TimeEditAction; reason: string | null; edited_by: string | null; created_at: string };
  const latestEdit = new Map<string, EditRow>();
  for (const e of (editRows ?? []) as EditRow[]) if (!latestEdit.has(e.row_id)) latestEdit.set(e.row_id, e);
  const noteFor = (id: string) => {
    const e = latestEdit.get(id);
    return e ? editNote(e, (e.edited_by && names.get(e.edited_by)) || "office", formatEtDate(e.created_at)) : null;
  };
  const span = (startedAt: string, endedAt: string | null) =>
    `${formatEtDateTime(startedAt, { weekday: "short", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })} to ${
      endedAt ? formatEtTime(endedAt) : "now (running)"
    }`;
  const timeRowsFor = (staffId: string): TimeRowView[] => {
    const shiftViews = weekShifts
      .filter((s) => s.staff_id === staffId)
      .map((s) => ({
        sort: s.started_at,
        view: {
          table: "time_shifts" as const,
          id: s.id,
          label: "Day shift",
          when: span(s.started_at, s.ended_at),
          amount: s.ended_at ? `${paidShiftHours(s.started_at, s.ended_at, s.break_minutes).toFixed(2)} hrs paid` : "running",
          startLocal: toEtLocalInput(s.started_at),
          endLocal: s.ended_at ? toEtLocalInput(s.ended_at) : "",
          breakMinutes: s.break_minutes,
          kind: null,
          voided: !!s.voided_at,
          voidedReason: s.voided_reason ?? null,
          flagReason: s.flagged && !s.reviewed_at ? (s.flag_reason ?? "Flagged") : null,
          editNote: noteFor(s.id),
        },
      }));
    const entryViews = weekEntries
      .filter((e) => e.staff_id === staffId)
      .map((e) => {
        const job = jobById.get(e.job_id);
        return {
          sort: e.started_at,
          view: {
            table: "job_time_entries" as const,
            id: e.id,
            label: `Job ${e.kind === "drive" ? "drive" : "work"}: ${job ? jobLabel(job) : "job"}`,
            when: span(e.started_at, e.ended_at),
            amount: e.ended_at ? `${hoursBetween(e.started_at, e.ended_at).toFixed(2)} hrs` : "running",
            startLocal: toEtLocalInput(e.started_at),
            endLocal: e.ended_at ? toEtLocalInput(e.ended_at) : "",
            breakMinutes: null,
            kind: e.kind === "drive" ? ("drive" as const) : ("work" as const),
            voided: !!e.voided_at,
            voidedReason: e.voided_reason ?? null,
            flagReason: e.flagged && !e.reviewed_at ? (e.flag_reason ?? "Flagged") : null,
            editNote: noteFor(e.id),
          },
        };
      });
    return [...shiftViews, ...entryViews].sort((a, b) => a.sort.localeCompare(b.sort)).map((r) => r.view);
  };
  const people = ((staff ?? []) as StaffRow[])
    .map((s) => ({ id: s.id, name: s.name?.trim() || s.email || "Staff" }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const addDay = start === mondayOf(today) ? today : start;

  type Group = { name: string; hours: number; jobs: JobRow[] };
  const groups = new Map<string, Group>();
  for (const job of (jobs ?? []) as unknown as JobRow[]) {
    const key = job.assigned_staff_id ?? "none";
    const g: Group = groups.get(key) ?? {
      name: job.assigned_staff_id ? names.get(job.assigned_staff_id) ?? "Unknown staff" : "Unassigned",
      hours: 0,
      jobs: [],
    };
    g.hours += job.tracked_hours ?? 0;
    g.jobs.push(job);
    groups.set(key, g);
  }
  const rows = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  const isCurrent = start === mondayOf(today);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className={headingClass}>Weekly hours</h1>
        <p className={subTextClass}>
          On-site hours from completed jobs, Mon–Sun. Measured from arrival to completion, so it
          is job time, not a full clock-in. Use it as the starting point for payroll.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Time clock: payroll hours</h2>
          <a href={`/hours/export?week=${start}`} className={buttonSecondaryClass}>
            Download hours file (CSV)
          </a>
        </div>
        <p className={subTextClass}>
          Clock-in to clock-out for the day, less the unpaid meal break. Overtime is anything over 40 paid hours in the
          Mon–Sun week. Gusto does the pay math: check the columns against Gusto&apos;s import with one real pay period.
        </p>
        {report.length === 0 ? (
          <p className={subTextClass}>No clocked time this week.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-[11px] font-bold uppercase tracking-wide text-g300">
                <tr>
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Paid</th>
                  <th className="py-2 pr-3">Regular</th>
                  <th className="py-2 pr-3">Overtime</th>
                  <th className="py-2 pr-3">On jobs</th>
                  <th className="py-2 pr-3">Drive</th>
                  <th className="py-2 pr-3">Other</th>
                  <th className="py-2">Flags</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/8 font-mono text-white">
                {report.map((r) => (
                  <tr key={r.staffId}>
                    <td className="py-2 pr-3 font-sans">
                      {r.name}
                      {r.openShift && <span className="ml-2 text-[10px] uppercase text-accent">on the clock</span>}
                    </td>
                    <td className="py-2 pr-3">{r.paidHours.toFixed(2)}</td>
                    <td className="py-2 pr-3">{r.regular.toFixed(2)}</td>
                    <td className="py-2 pr-3">{r.overtime.toFixed(2)}</td>
                    <td className="py-2 pr-3">{r.jobHours.toFixed(2)}</td>
                    <td className="py-2 pr-3">{r.driveHours.toFixed(2)}</td>
                    <td className="py-2 pr-3">{r.otherHours.toFixed(2)}</td>
                    <td className="py-2">{r.flagged || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {flags.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xs font-bold uppercase tracking-wide text-accent">Needs a look ({flags.length})</h2>
          <div className="flex flex-col divide-y divide-white/8">
            {flags.map((f) => (
              <div key={`${f.table}-${f.id}`} className="flex flex-col gap-2 py-3">
                <div className={itemTitleClass}>
                  {f.what}: {names.get(f.staff_id) ?? "Staff"}
                </div>
                <div className={itemSubClass}>
                  {formatEtDateTime(f.started_at)} to {f.ended_at ? formatEtDateTime(f.ended_at) : "still open"}
                </div>
                <div className="text-sm text-accent">{f.flag_reason}</div>
                <div className="flex flex-wrap items-center gap-2">
                  <form action={markTimeReviewed}>
                    <input type="hidden" name="table" value={f.table} />
                    <input type="hidden" name="id" value={f.id} />
                    <button className={buttonSecondaryClass}>It&apos;s fine</button>
                  </form>
                  {/* Fixing happens in Time by person, for the week the row started in. */}
                  <Link
                    href={`/hours?week=${mondayOf(etDate(new Date(f.started_at)))}#t-${f.id}`}
                    className={buttonSecondaryClass}
                  >
                    Fix it
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="flex items-center gap-2">
        <Link href={`/hours?week=${addDays(start, -7)}`} className={buttonSecondaryClass}>← Prev</Link>
        <div className={itemTitleClass}>{label(start)} – {label(addDays(start, 6))}</div>
        {!isCurrent && (
          <>
            <Link href={`/hours?week=${addDays(start, 7)}`} className={buttonSecondaryClass}>Next →</Link>
            <Link href="/hours" className={buttonSecondaryClass}>This week</Link>
          </>
        )}
      </div>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Time by person (this week)</h2>
          <p className={subTextClass}>
            Every day shift and job timer, New York time. Edit start, end and meal break, add time someone forgot to
            clock, or void a wrong entry. Each change needs a short reason and is logged with who made it. Voided rows
            stay here greyed out and are left out of payroll, the hours file and job hours.
          </p>
        </div>
        {people.map((p) => {
          const timeRows = timeRowsFor(p.id);
          return (
            <div key={p.id} className="flex flex-col gap-2 rounded-xl border border-white/8 bg-white/3 p-3">
              <h3 className={itemTitleClass}>{p.name}</h3>
              {timeRows.length === 0 ? (
                <p className={subTextClass}>No clocked time this week.</p>
              ) : (
                <div className="flex flex-col divide-y divide-white/8">
                  {timeRows.map((r) => (
                    <TimeRowEditor key={`${r.table}-${r.id}`} row={r} />
                  ))}
                </div>
              )}
              <AddTimeForm staffId={p.id} jobs={jobChoices} defaultDay={addDay} />
            </div>
          );
        })}
      </section>

      {error && <p className="text-sm text-accent">Couldn&apos;t load hours: {error.message}</p>}
      {!error && rows.length === 0 && <p className={subTextClass}>No completed jobs this week.</p>}

      {rows.map((g) => (
        <section key={g.name} className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wide text-g300">{g.name}</h2>
            <div className="font-mono text-sm text-white">{g.hours.toFixed(2)} hrs</div>
          </div>
          <div className="flex flex-col divide-y divide-white/8">
            {g.jobs.map((j) => (
              <div key={j.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <div className={itemTitleClass}>{j.customers?.name ?? "Customer"}</div>
                  <div className={itemSubClass}>
                    {label(etDate(new Date(j.completed_at)))}
                    {j.properties?.address ? ` · ${j.properties.address}` : ""}
                  </div>
                </div>
                <div className="font-mono text-sm text-white">
                  {j.tracked_hours != null ? `${j.tracked_hours} hrs` : "no hours"}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
