"use client";

import { useActionState } from "react";
import { unsubscribe, type UnsubscribeState } from "./actions";
import { buttonClass, errorClass } from "../../(internal)/ui";

export default function UnsubscribeForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<UnsubscribeState, FormData>(unsubscribe, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      <button type="submit" disabled={pending} className={`${buttonClass} w-fit disabled:opacity-50`}>
        {pending ? "One moment…" : "Unsubscribe me"}
      </button>
      {state.error && <p className={errorClass}>{state.error}</p>}
    </form>
  );
}
