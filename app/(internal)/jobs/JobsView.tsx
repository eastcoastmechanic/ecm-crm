"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { addJobPhotos, markOnWay, rescheduleJob, updateJobStatus } from "./actions";
import { addTask, completeTask } from "../tasks/actions";
import SubmitButton from "../SubmitButton";
import { buttonClass, buttonSecondaryClass, errorClass, inputClass, itemSubClass, itemTitleClass, subTextClass } from "../ui";

const statusOptions = ["requested", "scheduled", "in_progress", "complete", "cancelled"];

const statusDotClass: Record<string, string> = {
  requested: "bg-g500",
  scheduled: "bg-blue",
  in_progress: "bg-gold",
  complete: "bg-green",
  cancelled: "bg-g700",
};

type Task = {
  id: string;
  title: string;
  notes: string | null;
  due_at: string | null;
};

type Job = {
  id: string;
  scheduled_at: string | null;
  status: string;
  notes: string | null;
  on_way_at: string | null;
  tracked_hours: number | null;
  created_via: string | null;
  customers: { name: string | null } | null;
  properties: { address: string | null } | null;
  diagnostics: { id: string }[] | null;
  install_reports: { id: string }[] | null;
  photos: { url: string; caption: string | null }[] | null;
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

export default function JobsView({
  jobs,
  tasks,
  hourlyRate,
}: {
  jobs: Job[];
  tasks: Task[];
  hourlyRate: number | null;
}) {
  const router = useRouter();
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [actionError, setActionError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [onWayPendingId, setOnWayPendingId] = useState<string | null>(null);
  const [optimizeDate, setOptimizeDate] = useState(() => toDateKey(new Date()));
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeMessage, setOptimizeMessage] = useState<string | null>(null);
  const [addingTaskFor, setAddingTaskFor] = useState<string | null>(null);
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);

  const days = useMemo(() => monthGrid(monthCursor), [monthCursor]);
  const today = new Date();

  const filteredJobs = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return jobs;
    return jobs.filter((j) =>
      [j.customers?.name, j.properties?.address, j.status, j.notes]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(query))
    );
  }, [jobs, search]);

  function jobsOn(day: Date) {
    return filteredJobs.filter((j) => j.scheduled_at && sameDate(new Date(j.scheduled_at), day));
  }

  function tasksOn(day: Date) {
    return tasks.filter((t) => t.due_at && sameDate(new Date(t.due_at), day));
  }

  async function handleCompleteTask(taskId: string) {
    setCompletingTaskId(taskId);
    try {
      await completeTask(taskId);
      router.refresh();
    } finally {
      setCompletingTaskId(null);
    }
  }

  async function handleDrop(day: Date, jobId: string) {
    setActionError(null);
    try {
      await rescheduleJob(jobId, toDateKey(day));
      router.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to reschedule job");
    }
  }

  async function handleRescheduleInput(jobId: string, newDate: string) {
    if (!newDate) return;
    setActionError(null);
    try {
      await rescheduleJob(jobId, newDate);
      router.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to reschedule job");
    }
  }

  async function handleOnWay(jobId: string) {
    setActionError(null);
    setOnWayPendingId(jobId);
    try {
      await markOnWay(jobId);
      router.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to notify customer");
    } finally {
      setOnWayPendingId(null);
    }
  }

  async function handleOptimize() {
    setOptimizing(true);
    setOptimizeMessage(null);
    try {
      const res = await fetch("/api/dispatch/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: optimizeDate }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setOptimizeMessage(data.error ?? "Failed to optimize route");
      } else if (!data.optimized) {
        setOptimizeMessage(data.reason ?? "Nothing to optimize.");
      } else {
        setOptimizeMessage(`Route optimized for ${optimizeDate} — ${data.order.length} stops reordered.`);
        router.refresh();
      }
    } catch {
      setOptimizeMessage("Failed to reach the optimization service.");
    } finally {
      setOptimizing(false);
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
        <div className="ml-auto flex items-center gap-2">
          <input
            type="date"
            aria-label="Date to optimize"
            value={optimizeDate}
            onChange={(e) => setOptimizeDate(e.target.value)}
            className={inputClass}
          />
          <button
            onClick={handleOptimize}
            disabled={optimizing}
            className={`${buttonSecondaryClass} disabled:opacity-50`}
          >
            {optimizing ? "Optimizing…" : "Optimize Route"}
          </button>
        </div>
      </div>
      {optimizeMessage && <p className={subTextClass}>{optimizeMessage}</p>}

      <input
        type="text"
        placeholder="Search jobs…"
        aria-label="Search jobs"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className={inputClass}
      />

      {actionError && <p className={errorClass}>{actionError}</p>}

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
              const dayTasks = tasksOn(day);
              const dateKey = toDateKey(day);
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
                  <div className="flex items-center justify-between">
                    <span className={`text-[11px] ${isToday ? "font-bold text-accent" : "text-g500"}`}>
                      {day.getDate()}
                    </span>
                    <button
                      type="button"
                      onClick={() => setAddingTaskFor(addingTaskFor === dateKey ? null : dateKey)}
                      title="Add task"
                      className="rounded px-1 text-[11px] leading-none text-g500 hover:bg-white/8 hover:text-white"
                    >
                      +
                    </button>
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
                  {dayTasks.map((task) => (
                    <div
                      key={task.id}
                      className="flex items-start gap-1 rounded bg-gold/15 px-1.5 py-1 text-[11px] leading-tight text-gold"
                      title={task.notes ?? ""}
                    >
                      <input
                        type="checkbox"
                        checked={false}
                        onChange={() => handleCompleteTask(task.id)}
                        disabled={completingTaskId === task.id}
                        className="mt-0.5"
                        aria-label={`Mark "${task.title}" complete`}
                      />
                      <span>{task.title}</span>
                    </div>
                  ))}
                  {addingTaskFor === dateKey && (
                    <form
                      action={async (formData) => {
                        await addTask(formData);
                        setAddingTaskFor(null);
                        router.refresh();
                      }}
                      className="mt-1 flex flex-col gap-1"
                    >
                      <input type="hidden" name="due_date" value={dateKey} />
                      <input
                        name="title"
                        autoFocus
                        placeholder="Task…"
                        required
                        className="w-full rounded border border-white/8 bg-white/4 px-1.5 py-1 text-[11px] text-white outline-none focus:border-accent"
                      />
                      <div className="flex gap-1">
                        <button
                          type="submit"
                          className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-white"
                        >
                          Add
                        </button>
                        <button
                          type="button"
                          onClick={() => setAddingTaskFor(null)}
                          className="rounded px-1.5 py-0.5 text-[10px] text-g300 hover:text-white"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-white/8">
          {filteredJobs.length === 0 && <p className={subTextClass}>No jobs match.</p>}
          {filteredJobs.map((job) => (
            <div key={job.id} className="flex flex-col gap-2 py-3">
            <form
              action={updateJobStatus}
              className="flex flex-wrap items-center justify-between gap-3"
            >
              <input type="hidden" name="id" value={job.id} />
              <div>
                <div className={itemTitleClass}>
                  {job.customers?.name ?? "Unknown customer"}
                  {job.properties?.address ? ` — ${job.properties.address}` : ""}
                  {job.created_via === "ai_sms" && (
                    <span className="ml-2 rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                      via AI text
                    </span>
                  )}
                  {job.created_via === "ai_voice" && (
                    <span className="ml-2 rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                      via AI call
                    </span>
                  )}
                </div>
                <div className={itemSubClass}>
                  {job.scheduled_at ? new Date(job.scheduled_at).toLocaleString() : "No date"}
                  {job.notes ? ` · ${job.notes}` : ""}
                  {job.on_way_at ? ` · On the way at ${new Date(job.on_way_at).toLocaleTimeString()}` : ""}
                  {job.tracked_hours
                    ? ` · Tracked: ${job.tracked_hours} hrs${
                        hourlyRate
                          ? ` ($${(Math.max(job.tracked_hours, 2) * hourlyRate).toFixed(2)}${
                              job.tracked_hours < 2 ? ", 2 hr min" : ""
                            })`
                          : ""
                      }`
                    : ""}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {job.diagnostics && job.diagnostics.length > 0 ? (
                  <Link href={`/diagnostics/${job.diagnostics[0].id}`} className={buttonSecondaryClass}>
                    View Report
                  </Link>
                ) : (
                  <Link href={`/diagnostics/new?job_id=${job.id}`} className={buttonSecondaryClass}>
                    + Report
                  </Link>
                )}
                {job.install_reports && job.install_reports.length > 0 ? (
                  <Link href={`/tech-hub/install-report/${job.install_reports[0].id}`} className={buttonSecondaryClass}>
                    View Install
                  </Link>
                ) : (
                  <Link href={`/tech-hub/install-report/new?job_id=${job.id}`} className={buttonSecondaryClass}>
                    + Install
                  </Link>
                )}
                {!job.on_way_at && (job.status === "scheduled" || job.status === "in_progress") && (
                  <button
                    type="button"
                    onClick={() => handleOnWay(job.id)}
                    disabled={onWayPendingId === job.id}
                    className={`${buttonSecondaryClass} disabled:opacity-50`}
                  >
                    {onWayPendingId === job.id ? "Sending…" : "On My Way"}
                  </button>
                )}
                <label className="flex flex-col gap-0.5 text-[10px] text-g300">
                  Date
                  <input
                    type="date"
                    defaultValue={job.scheduled_at ? toDateKey(new Date(job.scheduled_at)) : ""}
                    onChange={(e) => handleRescheduleInput(job.id, e.target.value)}
                    className={inputClass}
                  />
                </label>
                <select name="status" defaultValue={job.status} className={inputClass} aria-label="Job status">
                  {statusOptions.map((s) => (
                    <option key={s} value={s}>
                      {s.replace("_", " ")}
                    </option>
                  ))}
                </select>
                <SubmitButton className={buttonClass}>Save</SubmitButton>
              </div>
            </form>

              {job.photos && job.photos.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {job.photos.map((photo, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={i}
                      src={photo.url}
                      alt={photo.caption ?? "Job photo"}
                      className="h-16 w-16 rounded-lg object-cover"
                    />
                  ))}
                </div>
              )}
              <form action={addJobPhotos} className="flex items-center gap-2">
                <input type="hidden" name="job_id" value={job.id} />
                <input
                  type="file"
                  name="photos"
                  accept="image/*"
                  multiple
                  aria-label="Add before/after photos"
                  className="text-xs text-g300 file:mr-2 file:rounded file:border-0 file:bg-white/8 file:px-2 file:py-1 file:text-xs file:text-white"
                />
                <SubmitButton className={buttonSecondaryClass} pendingText="Uploading…">
                  Add Photos
                </SubmitButton>
              </form>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
