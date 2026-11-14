"use client";

import { useActionState } from "react";
import SubmitButton from "../SubmitButton";
import { buttonClass, errorClass, inputClass } from "../ui";
import { saveJobEdit, type JobEditState } from "./edit-actions";
import { JOB_STATUS_OPTIONS, normalizeJobStatus } from "@/lib/job-edit-rules";
import type { InvoicePrompt } from "@/lib/job-invoice-rules";

export const JOB_STATUS_LABEL: Record<string, string> = {
  requested: "Requested",
  scheduled: "Scheduled",
  in_progress: "In progress",
  complete: "Complete",
  cancelled: "Cancelled",
};

/**
 * Quick status change on a /jobs row (owner/office). Goes through saveJobEdit, so Complete
 * runs the normal finish lifecycle, and a job not finished on the truck asks why before it
 * is marked done (logged like the owner unlock).
 */
export default function JobStatusForm({
  jobId,
  status,
  onInvoicePrompt,
}: {
  jobId: string;
  status: string;
  onInvoicePrompt: (prompt: InvoicePrompt) => void;
}) {
  // The invoice prompt goes up as soon as the action returns, not from an effect: a job marked
  // done leaves the Active tab, so this row can unmount before an effect would run.
  const [state, action] = useActionState<JobEditState, FormData>(async (prev, formData) => {
    const result = await saveJobEdit(prev, formData);
    if (result?.invoicePrompt) onInvoicePrompt(result.invoicePrompt);
    return result;
  }, null);
  const current = normalizeJobStatus(status);

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="job_id" value={jobId} />
      <input type="hidden" name="original_status" value={current} />
      <div className="flex items-center gap-2">
        <select
          // A new saved status remounts the select so it shows it (the form itself stays, keeping its result).
          key={current}
          name="status"
          defaultValue={state?.values?.status ?? current}
          className={inputClass}
          aria-label="Job status"
        >
          {JOB_STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {JOB_STATUS_LABEL[s] ?? s}
            </option>
          ))}
        </select>
        <SubmitButton className={buttonClass}>Save</SubmitButton>
      </div>
      {state?.needsReason && (
        <label className="flex w-full max-w-sm flex-col gap-1 text-[11px] text-g300">
          Why mark it done anyway? (saved with your name)
          <input
            name="done_reason"
            defaultValue={state.values?.doneReason ?? ""}
            placeholder="e.g. Tech's phone died, work checked by me"
            className={inputClass}
          />
        </label>
      )}
      {state?.error && <p className={`${errorClass} max-w-sm text-right`}>{state.error}</p>}
    </form>
  );
}
