"use client";

import { useActionState } from "react";
import SubmitButton from "../SubmitButton";
import { buttonClass, inputClass } from "../ui";
import { createBalanceInvoice } from "./invoice-actions";

/** Finished job with no invoice: type the amount (prefilled from the contract) and create it. */
export default function CreateInvoiceForm({
  jobId,
  suggested,
  hint,
}: {
  jobId: string;
  /** Contract total minus deposit received, as dollars. Blank when there is no contract to read. */
  suggested: string;
  hint: string | null;
}) {
  const [state, action] = useActionState(createBalanceInvoice, null);
  return (
    <form action={action} className="mt-2 grid gap-1.5">
      <input type="hidden" name="job_id" value={jobId} />
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-g300" htmlFor={`amt-${jobId}`}>
          Invoice amount $
        </label>
        <input
          id={`amt-${jobId}`}
          name="amount"
          inputMode="decimal"
          defaultValue={suggested}
          placeholder="0.00"
          className={`${inputClass} w-32`}
        />
        <SubmitButton className={buttonClass} pendingText="Creating…">
          Create invoice
        </SubmitButton>
      </div>
      {hint && <p className="text-xs text-g300">{hint}</p>}
      {state?.error && <p className="text-sm text-accent">{state.error}</p>}
    </form>
  );
}
