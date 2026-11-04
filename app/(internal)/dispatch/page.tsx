import Link from "next/link";
import { headers } from "next/headers";
import { supabase } from "@/lib/supabase";
import { addDaysToDateKey, etDateKey, etDayRange, formatEtTime, toEtLocalInput } from "@/lib/tz";
import { monthName, visitOverdue } from "@/lib/maintenance-visits";
import { buttonClass, buttonSecondaryClass, headingClass, itemSubClass, itemTitleClass, subTextClass } from "../ui";
import JobEditor, { type StaffOption } from "./JobEditor";

export const dynamic = "force-dynamic";

const statusLabel: Record<string, string> = {
  requested: "Requested",
  scheduled: "Scheduled",
  in_progress: "In progress",
  complete: "Complete",
  completed: "Complete",
  cancelled: "Cancelled",
};
const statusBar: Record<string, string> = {
  requested: "border-l-g500",
  scheduled: "border-l-blue",
  in_progress: "border-l-gold",
  complete: "border-l-green",
  completed: "border-l-green",
  cancelled: "border-l-g700",
};

type Rel<T> = T | T[] | null;
type JobRow = {
  id: string;
  scheduled_at: string | null;
  status: string;
  job_type: string | null;
  assigned_staff_id: string | null;
  customers: Rel<{ name: string | null }>;
  properties: Rel<{ address: string | null }>;
};

function one<T>(v: Rel<T>): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

function mondayOf(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sun
  return addDaysToDateKey(key, -((dow + 6) % 7));
}

function dayLabel(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function JobBlock({ job, staff, planNote }: { job: JobRow; staff: StaffOption[]; planNote?: { text: string; overdue: boolean; request?: string } }) {
  const customer = one(job.customers);
  const property = one(job.properties);
  return (
    <details className={`rounded-lg border border-white/8 border-l-4 bg-white/3 p-2 ${statusBar[job.status] ?? "border-l-g500"}`}>
      <summary className="cursor-pointer list-none">
        <div className={itemTitleClass}>
          {job.scheduled_at ? formatEtTime(job.scheduled_at) : "No time"} · {customer?.name ?? "Customer not set"}
        </div>
        <div className={itemSubClass}>
          {property?.address ?? "No address"}
        </div>
        {planNote && (
          <div className={`text-xs font-semibold ${planNote.overdue ? "text-accent" : "text-gold"}`}>
            {planNote.overdue ? "Overdue plan visit" : "Plan visit"}: {planNote.text}
          </div>
        )}
        {planNote?.request && <div className="text-xs font-semibold text-green">{planNote.request}</div>}
        <div className="text-xs text-g300">
          {statusLabel[job.status] ?? job.status}
          {job.job_type ? ` · ${job.job_type}` : ""}
        </div>
      </summary>
      <JobEditor
        jobId={job.id}
        staffId={job.assigned_staff_id ?? ""}
        scheduledLocal={job.scheduled_at ? toEtLocalInput(job.scheduled_at) : ""}
        staff={staff}
      />
    </details>
  );
}

export default async function DispatchPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string }>;
}) {
  // proxy.ts already keeps techs off this path; second lock because the page edits everyone's jobs.
  if ((await headers()).get("x-staff-role") === "tech") {
    return <p className={subTextClass}>Not allowed.</p>;
  }

  const { view: viewParam, date } = await searchParams;
  const view = viewParam === "day" ? "day" : "week";
  const today = etDateKey();
  const picked = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today;
  const first = view === "week" ? mondayOf(picked) : picked;
  const step = view === "week" ? 7 : 1;
  const days = Array.from({ length: step }, (_, i) => addDaysToDateKey(first, i));
  const rangeStart = etDayRange(first).start;
  const rangeEnd = etDayRange(addDaysToDateKey(first, step - 1)).end;

  const [{ data: jobRows, error }, { data: unscheduledRows, error: unscheduledError }, { data: staffRows, error: staffError }, { data: visitRows }] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, scheduled_at, status, job_type, assigned_staff_id, customers(name), properties(address)")
      .neq("status", "cancelled")
      .gte("scheduled_at", rangeStart.toISOString())
      .lt("scheduled_at", rangeEnd.toISOString())
      .order("scheduled_at", { ascending: true }),
    supabase
      .from("jobs")
      .select("id, scheduled_at, status, job_type, assigned_staff_id, customers(name), properties(address)")
      .is("scheduled_at", null)
      .not("status", "in", "(complete,completed,cancelled)")
      .limit(50),
    supabase.from("staff").select("id, name, email").order("name"),
    supabase
      .from("maintenance_visits")
      .select("job_id, label, due_year, due_month, customer_request_at, customer_request_note")
      .eq("status", "due")
      .not("job_id", "is", null),
  ]);

  // Plan visits waiting on a date, so the list can say why a job is there and how late it is.
  const planNotes = new Map<string, { text: string; overdue: boolean; request?: string }>();
  for (const v of visitRows ?? []) {
    planNotes.set(v.job_id as string, {
      text: `${v.label ?? "Maintenance visit"}, due ${monthName(v.due_month as number)} ${v.due_year}`,
      overdue: visitOverdue(v.due_year as number, v.due_month as number, today),
      request: v.customer_request_at
        ? `Customer asked to book${v.customer_request_note ? `: ${v.customer_request_note}` : ''}`
        : undefined,
    });
  }

  const staff: StaffOption[] = (staffRows ?? []).map((s) => ({
    id: s.id as string,
    name: (s.name as string | null) || (s.email as string),
  }));
  const jobs = (jobRows ?? []) as unknown as JobRow[];
  const unscheduled = (unscheduledRows ?? []) as unknown as JobRow[];
  const columns = [...staff.map((s) => ({ id: s.id, name: s.name })), { id: "", name: "Unassigned" }];
  const knownIds = new Set(staff.map((s) => s.id));

  const colOf = (job: JobRow) =>
    job.assigned_staff_id && knownIds.has(job.assigned_staff_id) ? job.assigned_staff_id : "";
  const dayOf = (job: JobRow) => etDateKey(new Date(job.scheduled_at as string));

  const prev = addDaysToDateKey(first, -step);
  const next = addDaysToDateKey(first, step);
  const q = (d: string, v = view) => `/dispatch?view=${v}&date=${d}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className={headingClass}>Dispatch</h1>
          <p className={subTextClass}>
            Tap a job to change the tech or time. Customers get a new schedule notice when the time changes.
          </p>
        </div>
        <Link href="/jobs" className={buttonSecondaryClass}>
          Optimize route (Jobs page)
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link href={q(picked, "day")} className={view === "day" ? buttonClass : buttonSecondaryClass}>Day</Link>
        <Link href={q(picked, "week")} className={view === "week" ? buttonClass : buttonSecondaryClass}>Week</Link>
        <Link href={q(prev)} className={buttonSecondaryClass}>← Prev</Link>
        <Link href={q(today)} className={buttonSecondaryClass}>Today</Link>
        <Link href={q(next)} className={buttonSecondaryClass}>Next →</Link>
        <div className={itemTitleClass}>
          {view === "week" ? `${dayLabel(first)} – ${dayLabel(days[days.length - 1])}` : dayLabel(first)}
        </div>
      </div>

      {error && <p className="text-sm text-accent">Couldn&apos;t load jobs: {error.message}</p>}
      {staffError && (
        <p className="text-sm text-accent">
          Couldn&apos;t load staff: {staffError.message}. Techs may show as Unassigned until this loads.
        </p>
      )}

      <div className="overflow-x-auto">
        <div
          className="grid gap-2"
          style={{ gridTemplateColumns: `5.5rem repeat(${columns.length}, minmax(12rem, 1fr))`, minWidth: `${5.5 + columns.length * 12}rem` }}
        >
          <div />
          {columns.map((c) => (
            <div key={c.id || "none"} className="text-xs font-bold uppercase tracking-wide text-g300">
              {c.name}
            </div>
          ))}
          {days.map((day) => (
            <div key={day} className="contents">
              <div className={`${itemTitleClass} pt-2 text-sm ${day === today ? "text-accent" : ""}`}>{dayLabel(day)}</div>
              {columns.map((c) => {
                const cell = jobs.filter((j) => dayOf(j) === day && colOf(j) === c.id);
                return (
                  <div key={c.id || "none"} className="flex min-h-12 flex-col gap-2 rounded-lg border border-white/6 p-1">
                    {cell.map((j) => (
                      <JobBlock key={j.id} job={j} staff={staff} />
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Needs scheduling</h2>
        {unscheduledError ? (
          <p className="text-sm text-accent">Couldn&apos;t load unscheduled jobs: {unscheduledError.message}</p>
        ) : unscheduled.length === 0 ? (
          <p className={subTextClass}>Every open job has a date.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {unscheduled.map((j) => (
              <JobBlock key={j.id} job={j} staff={staff} planNote={planNotes.get(j.id)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
