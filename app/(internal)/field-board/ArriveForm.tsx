"use client";

import { useActionState } from "react";
import SubmitButton from "../SubmitButton";
import { arriveJobAction } from "./actions";

/** I'm here, with the reason shown on the card instead of an error page. */
export default function ArriveForm({ jobId, className }: { jobId: string; className: string }) {
  const [state, action] = useActionState(arriveJobAction, null);
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="id" value={jobId} />
      <SubmitButton className={className} pendingText="Saving…">
        I&apos;m here
      </SubmitButton>
      {state?.error && <p className="text-sm text-accent">{state.error}</p>}
    </form>
  );
}
