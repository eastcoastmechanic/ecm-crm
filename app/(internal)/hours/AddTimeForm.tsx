"use client";

import { useState } from "react";
import ResultForm from "../ResultForm";
import { buttonClass, buttonSecondaryClass, inputClass, subTextClass } from "../ui";
import { addMissedTime } from "./actions";

const labelClass = "flex flex-col gap-1 text-[11px] text-g300";

/** "Add missed time" for one person: a day shift, or a job timer on a chosen job. */
export default function AddTimeForm({
  staffId,
  jobs,
  defaultDay,
}: {
  staffId: string;
  jobs: { id: string; label: string }[];
  /** YYYY-MM-DD to start the date pickers on. */
  defaultDay: string;
}) {
  const [open, setOpen] = useState(false);
  const [table, setTable] = useState<"time_shifts" | "job_time_entries">("time_shifts");

  if (!open) {
    return (
      <div>
        <button type="button" className={buttonSecondaryClass} onClick={() => setOpen(true)}>
          + Add missed time
        </button>
      </div>
    );
  }

  return (
    <ResultForm
      submit={addMissedTime}
      resetOnDone
      onDone={() => setOpen(false)}
      className="grid gap-2 rounded-xl border border-white/8 bg-white/3 p-3 sm:grid-cols-2"
    >
      <input type="hidden" name="staff_id" value={staffId} />
      <label className={labelClass}>
        What
        <select
          name="table"
          value={table}
          onChange={(e) => setTable(e.target.value as "time_shifts" | "job_time_entries")}
          className={inputClass}
        >
          <option value="time_shifts">Day shift (clock in to clock out)</option>
          <option value="job_time_entries">Job timer</option>
        </select>
      </label>
      {table === "job_time_entries" ? (
        <>
          <label className={labelClass}>
            Job
            <select name="job_id" className={inputClass} required defaultValue="">
              <option value="" disabled>
                Pick a job
              </option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.label}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Kind
            <select name="kind" defaultValue="work" className={inputClass}>
              <option value="work">Work (on the job)</option>
              <option value="drive">Drive</option>
            </select>
          </label>
        </>
      ) : (
        <label className={labelClass}>
          Meal break (minutes)
          <input type="number" name="break_minutes" min={0} max={480} step={1} defaultValue={0} className={inputClass} />
        </label>
      )}
      <label className={labelClass}>
        Start (New York time)
        <input type="datetime-local" name="started_at" defaultValue={`${defaultDay}T07:00`} className={inputClass} required />
      </label>
      <label className={labelClass}>
        End
        <input type="datetime-local" name="ended_at" defaultValue={`${defaultDay}T15:30`} className={inputClass} required />
      </label>
      <label className={labelClass}>
        Reason (required)
        <input name="reason" maxLength={200} placeholder="Forgot to clock in" className={inputClass} required />
      </label>
      <div className="flex items-center gap-2 sm:col-span-2">
        <button className={buttonClass}>Add time</button>
        <button type="button" className={`${subTextClass} underline`} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </ResultForm>
  );
}
