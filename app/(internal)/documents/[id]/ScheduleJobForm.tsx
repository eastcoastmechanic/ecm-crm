"use client";

import { useActionState } from "react";
import SubmitButton from "../../SubmitButton";
import { scheduleJobFromContract } from "../../jobs/actions";
import { buttonClass, errorClass, inputClass } from "../../ui";

/** Signed contract with no job yet: pick the date and schedule it. Problems show here, not on an error page. */
export default function ScheduleJobForm({ documentId }: { documentId: string }) {
  const [state, action] = useActionState(scheduleJobFromContract, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="document_id" value={documentId} />
      <label className="flex flex-col gap-1 text-xs text-g300">
        Job date and time
        <input type="datetime-local" name="scheduled_at" required className={inputClass} />
      </label>
      <SubmitButton className={buttonClass} pendingText="Scheduling…">
        Schedule job
      </SubmitButton>
      {state?.error && <p className={`${errorClass} w-full`}>{state.error}</p>}
    </form>
  );
}
