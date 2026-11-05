"use client";

import { useActionState } from "react";
import SubmitButton from "../SubmitButton";
import { finishJobAction } from "./checklist-actions";

const bigButton =
  "w-full rounded-xl bg-gradient-to-br from-accent to-accent-2 px-4 py-4 text-base font-bold uppercase tracking-wide text-white shadow-[0_2px_8px_rgba(232,80,42,.3)] transition-opacity hover:opacity-90";

/** Finish job, with the reason shown inline when the checklist or photo is not done. */
export default function FinishForm({ jobId, blockers }: { jobId: string; blockers: string[] }) {
  const [state, action] = useActionState(finishJobAction, null);
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="id" value={jobId} />
      <input type="hidden" name="status" value="complete" />
      {blockers.length > 0 && !state?.error && (
        <p className="text-sm text-g300">Before you finish: {blockers.join(" ")}</p>
      )}
      {state?.error && <p className="text-sm text-accent">{state.error}</p>}
      <SubmitButton className={bigButton} pendingText="Saving…">
        Finish job
      </SubmitButton>
    </form>
  );
}
