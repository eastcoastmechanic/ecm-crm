"use client";

import { useActionState } from "react";
import { createDepositCheckout, type PayState } from "./actions";
import SubmitButton from "../../../(internal)/SubmitButton";
import { buttonClass, errorClass, subTextClass } from "../../../(internal)/ui";

/** Pay deposit on a signed contract. The amount shown is for the customer only; the server works it out again. */
export default function DepositPayForm({ documentId, amount }: { documentId: string; amount: string }) {
  const [state, action] = useActionState<PayState, FormData>(createDepositCheckout, null);
  return (
    <form action={action} className="rounded-xl border border-white/8 bg-white/3 p-4">
      <input type="hidden" name="document_id" value={documentId} />
      <p className={subTextClass}>
        Deposit due now: <span className="text-white">{amount}</span>. The balance is due when the work is done.
      </p>
      {state?.error && (
        <p role="alert" className={`${errorClass} mt-2`}>
          {state.error}
        </p>
      )}
      <SubmitButton className={`${buttonClass} mt-3 w-fit`} pendingText="Redirecting…">
        Pay deposit {amount}
      </SubmitButton>
    </form>
  );
}
