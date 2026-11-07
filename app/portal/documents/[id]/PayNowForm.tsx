"use client";

import { useActionState } from "react";
import { createCheckoutSession, type PayState } from "./actions";
import SubmitButton from "../../../(internal)/SubmitButton";
import { buttonClass, errorClass, subTextClass } from "../../../(internal)/ui";

export default function PayNowForm({ documentId, amount }: { documentId: string; amount: string }) {
  const [state, action] = useActionState<PayState, FormData>(createCheckoutSession, null);
  return (
    <form action={action} className="rounded-xl border border-white/8 bg-white/3 p-4">
      <input type="hidden" name="document_id" value={documentId} />
      <p className={subTextClass}>
        Amount due: <span className="text-white">{amount}</span>
      </p>
      {state?.error && (
        <p role="alert" className={`${errorClass} mt-2`}>
          {state.error}
        </p>
      )}
      <SubmitButton className={`${buttonClass} mt-3 w-fit`} pendingText="Redirecting…">
        Pay Now
      </SubmitButton>
    </form>
  );
}
