"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { rescheduleJob, updateJobStatus } from "./actions";
import { buttonClass, buttonSecondaryClass, inputClass, itemSubClass, itemTitleClass, subTextClass } from "../ui";

const statusOptions = ["requested", "scheduled", "in_progress", "complete", "cancelled"];

const statusDotClass: Record<string, string> = {
  requested: "bg-g500",
  scheduled: "bg-blue",
  in_progress: "bg-gold",
  complete: "bg-green",
  cancelled: "bg-g700",
};

type Job = {
  id: string;
  scheduled_at: string | null;
  status: string;
  notes: string | null;
  customers: { name: string | null } | null;
  properties: { address: string | null } | null;
};

function sameDate(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function toDateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthGrid(cursor: Date) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - firstOfMonth.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
}

export default function JobsView({ jobs }: { jobs: Job[] }) {
  const router = useRouter();
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [dragError, setDragError] = useState<string | null>(null);

  const days = useMemo(() => monthGrid(monthCursor), [monthCursor]);
  const today = new Date();

  function jobsOn(day: Date) {
    return jobs.filter((j) => j.scheduled_at && sameDate(new Date(j.scheduled_at), day));
  }

  async function handleDrop(day: Date, jobId: string) {
    setDragError(null);
    try {
      await rescheduleJob(jobId, toDateKey(day));
      router.refresh();
    } catch (err) {
      setDragError(err instanceof Error ? err.message : "Failed to reschedule job");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setView("calendar")}
          className={view === "calendar" ? buttonClass : buttonSecondaryClass}
        >
          Calendar
        </button>
        <button
          onClick={() => setView("list")}
          className={view === "list" ? buttonClass : buttonSecondaryClass}
        >
          List
        </button>
      </div>

      {dragError && <p className="text-sm text-accent">{dragError}</p>}

      {view === "calendar" ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() - 1, 1))}
              className={buttonSecondaryClass}
            >
              ← Prev
            </button>
            <div className="font-display text-lg font-bold">
              {monthCursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
            </div>
            <button
              onClick={() => setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1))}
              className={buttonSecondaryClass}
            >
              Next →
            </button>
          </div>

          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-white/8 bg-white/8">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="bg-navy-2 px-2 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wide text-g500">
                {d}
              </div>
            ))}
            {days.map((day) => {
              const inMonth = day.getMonth() === monthCursor.getMonth();
              const isToday = sameDate(day, today);
              const dayJobs = jobsOn(day);
              return (
                <div
                  key={day.toISOString()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const jobId = e.dataTransfer.getData("text/plain");
                    if (jobId) handleDrop(day, jobId);
                  }}
                  className={`flex min-h-24 flex-col gap-1 bg-navy p-1.5 ${inMonth ? "" : "opacity-40"}`}
                >
                  <div className={`text-[11px] ${isToday ? "font-bold text-accent" : "text-g500"}`}>
                    {day.getDate()}
                  </div>
                  {dayJobs.map((job) => (
                    <div
                      key={job.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("text/plain", job.id)}
                      className="cursor-grab rounded bg-white/6 px-1.5 py-1 text-[11px] leading-tight hover:bg-white/10"
                      title={job.properties?.address ?? ""}
                    >
                      <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${statusDotClass[job.status] ?? "bg-g500"}`} />
                      {job.customers?.name ?? "Unknown"}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-white/8">
          {jobs.length === 0 && <p className={subTextClass}>No jobs yet.</p>}
          {jobs.map((job) => (
            <form
              key={job.id}
              action={updateJobStatus}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <input type="hidden" name="id" value={job.id} />
              <div>
                <div className={itemTitleClass}>
                  {job.customers?.name ?? "Unknown customer"}
                  {job.properties?.address ? ` — ${job.properties.address}` : ""}
                </div>
                <div className={itemSubClass}>
                  {job.scheduled_at ? new Date(job.scheduled_at).toLocaleString() : "No date"}
                  {job.notes ? ` · ${job.notes}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <select name="status" defaultValue={job.status} className={inputClass}>
                  {statusOptions.map((s) => (
                    <option key={s} value={s}>
                      {s.replace("_", " ")}
                    </option>
                  ))}
                </select>
                <button type="submit" className={buttonClass}>
                  Save
                </button>
              </div>
            </form>
          ))}
        </div>
      )}
    </div>
  );
}
