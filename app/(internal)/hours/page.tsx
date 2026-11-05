import Link from "next/link";
import { headers } from "next/headers";
import { supabase } from "@/lib/supabase";
import { buildWeekReport, type EntryRow, type ShiftRow, type StaffRow } from "@/lib/time-report";
import { fixTimeEnd, markTimeReviewed } from "./actions";
import { formatEtDateTime, toEtLocalInput } from "@/lib/tz";
import { buttonSecondaryClass, inputClass, headingClass, itemSubClass, itemTitleClass, subTextClass } from "../ui";

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
    supabase
      .from("time_shifts")
      .select("id, staff_id, started_at, ended_at, break_minutes, flagged, reviewed_at")
      .gte("started_at", fromIso)
      .lt("started_at", toIso),
    supabase
      .from("job_time_entries")
      .select("id, job_id, staff_id, kind, started_at, ended_at, flagged, reviewed_at")
      .gte("started_at", fromIso)
      .lt("started_at", toIso),
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
                  {f.ended_at && (
                    <form action={fixTimeEnd} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="table" value={f.table} />
                      <input type="hidden" name="id" value={f.id} />
                      <input
                        type="datetime-local"
                        name="ended_at"
                        defaultValue={toEtLocalInput(f.ended_at)}
                        className={inputClass}
                        required
                      />
                      <button className={buttonSecondaryClass}>Fix end time</button>
                    </form>
                  )}
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
