"use client";

import { useActionState } from "react";
import SubmitButton from "../SubmitButton";
import { buttonClass, inputClass, itemSubClass } from "../ui";
import { logFieldNote } from "./actions";

type JobOption = { id: string; label: string };

export default function FieldNoteForm({ jobs }: { jobs: JobOption[] }) {
  const [state, action] = useActionState(
    async (_prev: { error?: string; success?: boolean } | null, formData: FormData) => logFieldNote(formData),
    null
  );

  return (
    <form action={action} className="grid gap-3">
      <select name="job_id" className={inputClass} defaultValue="">
        <option value="">No CRM job — note only</option>
        {jobs.map((job) => (
          <option key={job.id} value={job.id}>
            {job.label}
          </option>
        ))}
      </select>
      <input name="title" className={inputClass} placeholder="Short update" required />
      <textarea name="body" rows={3} className={inputClass} placeholder="What happened on site" />
      <select name="board_status" className={inputClass} defaultValue="">
        <option value="">Board status (optional)</option>
        <option value="active">Active</option>
        <option value="needs-attention">Needs attention</option>
        <option value="finished">Finished</option>
      </select>
      {state?.error && <p className="text-sm text-accent">{state.error}</p>}
      {state?.success && <p className={itemSubClass}>Logged to CRM.</p>}
      <SubmitButton className={buttonClass} pendingText="Saving…">
        Log field note
      </SubmitButton>
    </form>
  );
}
