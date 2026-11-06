"use client";

import { useActionState } from "react";
import SubmitButton from "../SubmitButton";
import { buttonSecondaryClass, errorClass, inputClass } from "../ui";
import { assignJob } from "./actions";

/** Assign a job to a tech (or Unassigned). Problems show under the form, not on an error page. */
export default function AssignJobForm({
  jobId,
  assignedStaffId,
  staff,
}: {
  jobId: string;
  assignedStaffId: string | null;
  staff: { id: string; name: string }[];
}) {
  const [state, action] = useActionState(assignJob, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="job_id" value={jobId} />
      <label className="flex items-center gap-2 text-[11px] text-g300">
        Assigned to
        <select
          name="staff_id"
          defaultValue={state?.staffId ?? assignedStaffId ?? ""}
          className={inputClass}
          aria-label="Assign job to"
        >
          <option value="">Unassigned</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <SubmitButton className={buttonSecondaryClass}>Assign</SubmitButton>
      {state?.error && <p className={`${errorClass} w-full`}>{state.error}</p>}
    </form>
  );
}
