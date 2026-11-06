"use client";

import { useActionState, useState } from "react";
import SubmitButton from "../SubmitButton";
import { buttonSecondaryClass, errorClass, inputClass } from "../ui";
import { setLeadFollowUp } from "./actions";

/** Next step + follow-up date on a board card. Collapsed until opened. */
export default function LeadFollowUpForm({
  leadId,
  nextStep,
  followUpOn,
}: {
  leadId: string;
  nextStep: string | null;
  followUpOn: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(setLeadFollowUp, null);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="self-start text-[11px] font-semibold text-g300 underline">
        {nextStep || followUpOn ? "Edit follow-up" : "+ Next step"}
      </button>
    );
  }

  return (
    <form action={action} className="grid gap-1.5">
      <input type="hidden" name="id" value={leadId} />
      <input
        name="next_step"
        defaultValue={state?.error ? state.nextStep : (nextStep ?? "")}
        maxLength={300}
        placeholder="Next step (call back, send quote…)"
        aria-label="Next step"
        className={`${inputClass} text-xs`}
      />
      <div className="flex items-center gap-2">
        <input
          type="date"
          name="follow_up_on"
          defaultValue={state?.error ? state.followUpOn : (followUpOn ?? "")}
          aria-label="Follow up by"
          className={`${inputClass} text-xs`}
        />
        <SubmitButton className={`${buttonSecondaryClass} text-xs`} pendingText="Saving…">
          Save
        </SubmitButton>
        <button type="button" onClick={() => setOpen(false)} className="text-[11px] text-g300">
          Close
        </button>
      </div>
      {state?.error && <p className={`${errorClass} text-xs`}>{state.error}</p>}
      {state?.saved && <p className="text-xs text-green">Saved.</p>}
    </form>
  );
}
