"use client";

import { useActionState } from "react";
import { saveDispatchEdit, type DispatchState } from "./actions";
import { buttonClass, errorClass, inputClass } from "../ui";

export type StaffOption = { id: string; name: string };

export default function JobEditor({
  jobId,
  staffId,
  scheduledLocal,
  staff,
}: {
  jobId: string;
  staffId: string;
  scheduledLocal: string; // "YYYY-MM-DDTHH:MM" in New York time, or ""
  staff: StaffOption[];
}) {
  const [state, action, pending] = useActionState<DispatchState, FormData>(saveDispatchEdit, {});
  return (
    <form action={action} className="mt-2 flex flex-col gap-2">
      <input type="hidden" name="job_id" value={jobId} />
      <input type="hidden" name="original_staff_id" value={staffId} />
      <input type="hidden" name="original_scheduled_at" value={scheduledLocal} />
      <label className="flex flex-col gap-1 text-xs text-g300">
        Tech
        <select name="staff_id" defaultValue={staffId} className={inputClass}>
          <option value="">Unassigned</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-g300">
        Date and time (New York)
        <input type="datetime-local" name="scheduled_at" defaultValue={scheduledLocal} className={inputClass} />
      </label>
      <button type="submit" disabled={pending} className={`${buttonClass} disabled:opacity-50`}>
        {pending ? "Saving…" : "Save"}
      </button>
      {state.error && <p className={errorClass}>{state.error}</p>}
      {state.saved && !state.error && <p className="text-xs text-g300">Saved.</p>}
    </form>
  );
}
