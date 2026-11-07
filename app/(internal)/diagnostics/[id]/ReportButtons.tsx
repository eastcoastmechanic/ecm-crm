"use client";

import { useActionState } from "react";
import { createInvoiceForFinishedReport, sendServiceReportEmail, type ReportState } from "./actions";
import SubmitButton from "../../SubmitButton";
import { buttonClass, buttonSecondaryClass, errorClass, subTextClass } from "../../ui";

function Result({ state, done }: { state: ReportState; done: string }) {
  if (state?.error) {
    return (
      <span role="alert" className={errorClass}>
        {state.error}
      </span>
    );
  }
  return state?.saved ? <span className={subTextClass}>{done}</span> : null;
}

/** Email the service report; shows why if it didn't go out. */
export function SendReportButton({ id, disabled }: { id: string; disabled: boolean }) {
  const [state, action] = useActionState<ReportState, FormData>(sendServiceReportEmail, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <SubmitButton className={buttonClass} disabled={disabled} pendingText="Sending…">
        Email to Customer
      </SubmitButton>
      <Result state={state} done="Sent." />
    </form>
  );
}

/** Office: raise the invoice for a report finished without one. */
export function CreateReportInvoiceButton({ id }: { id: string }) {
  const [state, action] = useActionState<ReportState, FormData>(createInvoiceForFinishedReport, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="diagnostic_id" value={id} />
      <SubmitButton className={buttonSecondaryClass} pendingText="Creating…">
        Create invoice from this report
      </SubmitButton>
      <Result state={state} done="Invoice created." />
    </form>
  );
}
