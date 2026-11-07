"use client";

import { useActionState } from "react";
import { sendDocumentEmail, type SendDocumentState } from "./actions";
import SubmitButton from "../../SubmitButton";
import { buttonClass, errorClass, subTextClass } from "../../ui";

/** "Send to customer" button that shows why a send failed instead of a blank error page. */
export default function SendDocumentForm({ id, label, lastSent }: { id: string; label: string; lastSent?: string | null }) {
  const [state, action] = useActionState<SendDocumentState, FormData>(sendDocumentEmail, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      {lastSent && !state?.sent && <span className={subTextClass}>Last sent {lastSent}</span>}
      <input type="hidden" name="id" value={id} />
      <SubmitButton className={buttonClass} pendingText="Sending…">
        {label}
      </SubmitButton>
      {state?.sent && <span className={subTextClass}>Sent.</span>}
      {state?.error && (
        <span role="alert" className={errorClass}>
          {state.error}
        </span>
      )}
    </form>
  );
}
