"use client";

import { useActionState } from "react";
import { requestVisit, type VisitRequestState } from "./actions";
import { buttonClass, errorClass, inputClass } from "../../(internal)/ui";

export default function RequestForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<VisitRequestState, FormData>(requestVisit, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      <label className="flex flex-col gap-1 text-xs text-g300">
        Days or times that work best (optional)
        <textarea name="note" rows={3} maxLength={500} className={inputClass} placeholder="Weekday mornings, not the 20th" />
      </label>
      <button type="submit" disabled={pending} className={`${buttonClass} w-fit disabled:opacity-50`}>
        {pending ? "Sending…" : "Request a visit"}
      </button>
      {state.error && <p className={errorClass}>{state.error}</p>}
    </form>
  );
}
