"use client";

import { useState } from "react";
import ResultForm from "../ResultForm";
import { buttonClass, buttonSecondaryClass, inputClass, itemSubClass, subTextClass } from "../ui";
import { editTimeEntry, voidTimeEntry } from "./actions";

export type TimeRowView = {
  table: "time_shifts" | "job_time_entries";
  id: string;
  /** "Day shift", "Job work: Smith", ... */
  label: string;
  /** "Mon 11/3, 7:02 AM to 3:30 PM" */
  when: string;
  /** "8.00 hrs" or "running" */
  amount: string;
  startLocal: string;
  /** Empty while the row is still running. */
  endLocal: string;
  breakMinutes: number | null;
  kind: "work" | "drive" | null;
  voided: boolean;
  voidedReason: string | null;
  flagReason: string | null;
  /** "Edited by Josh on 11/9/2026: forgot to clock out" */
  editNote: string | null;
};

const labelClass = "flex flex-col gap-1 text-[11px] text-g300";

/** One shift or job timer on /hours, with Edit and Void (each needs a short reason). */
export default function TimeRowEditor({ row }: { row: TimeRowView }) {
  const [mode, setMode] = useState<"edit" | "void" | null>(null);
  const running = !row.endLocal;

  return (
    <div id={`t-${row.id}`} className={`flex flex-col gap-2 py-3 ${row.voided ? "opacity-50" : ""}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className={`text-sm font-medium text-white ${row.voided ? "line-through" : ""}`}>{row.label}</div>
          <div className={itemSubClass}>
            {row.when}
            {row.breakMinutes ? ` · ${row.breakMinutes} min break` : ""}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-white">{row.voided ? "void" : row.amount}</span>
          {!row.voided && (
            <>
              <button type="button" className={buttonSecondaryClass} onClick={() => setMode(mode === "edit" ? null : "edit")}>
                Edit
              </button>
              {!running && (
                <button type="button" className={buttonSecondaryClass} onClick={() => setMode(mode === "void" ? null : "void")}>
                  Void
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {row.flagReason && !row.voided && <div className="text-xs text-accent">{row.flagReason}</div>}
      {row.voided && <div className="text-xs text-g300">Voided{row.voidedReason ? `: ${row.voidedReason}` : ""}</div>}
      {row.editNote && <div className="text-xs text-g300">{row.editNote}</div>}

      {mode === "edit" && (
        <ResultForm submit={editTimeEntry} onDone={() => setMode(null)} className="grid gap-2 sm:grid-cols-2">
          <input type="hidden" name="table" value={row.table} />
          <input type="hidden" name="id" value={row.id} />
          <label className={labelClass}>
            Start (New York time)
            <input type="datetime-local" name="started_at" defaultValue={row.startLocal} className={inputClass} required />
          </label>
          <label className={labelClass}>
            End {running ? "(leave blank to keep it running)" : ""}
            <input type="datetime-local" name="ended_at" defaultValue={row.endLocal} className={inputClass} required={!running} />
          </label>
          {row.table === "time_shifts" ? (
            <label className={labelClass}>
              Meal break (minutes)
              <input
                type="number"
                name="break_minutes"
                min={0}
                max={480}
                step={1}
                defaultValue={row.breakMinutes ?? 0}
                className={inputClass}
              />
            </label>
          ) : (
            <label className={labelClass}>
              Kind
              <select name="kind" defaultValue={row.kind ?? "work"} className={inputClass}>
                <option value="work">Work (on the job)</option>
                <option value="drive">Drive</option>
              </select>
            </label>
          )}
          <label className={labelClass}>
            Reason (required)
            <input name="reason" maxLength={200} placeholder="Forgot to clock out" className={inputClass} required />
          </label>
          <div className="flex items-center gap-2 sm:col-span-2">
            <button className={buttonClass}>Save change</button>
            <button type="button" className={`${subTextClass} underline`} onClick={() => setMode(null)}>
              Cancel
            </button>
          </div>
        </ResultForm>
      )}

      {mode === "void" && (
        <ResultForm submit={voidTimeEntry} onDone={() => setMode(null)} className="grid gap-2 sm:grid-cols-2">
          <input type="hidden" name="table" value={row.table} />
          <input type="hidden" name="id" value={row.id} />
          <label className={`${labelClass} sm:col-span-2`}>
            Why void it? (required) The row stays here, greyed, and is left out of payroll and the hours file.
            <input name="reason" maxLength={200} placeholder="Test entry" className={inputClass} required />
          </label>
          <div className="flex items-center gap-2 sm:col-span-2">
            <button className={buttonClass}>Void it</button>
            <button type="button" className={`${subTextClass} underline`} onClick={() => setMode(null)}>
              Cancel
            </button>
          </div>
        </ResultForm>
      )}
    </div>
  );
}
