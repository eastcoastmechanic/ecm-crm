"use client";

import { useActionState } from "react";
import SubmitButton from "../SubmitButton";
import { buttonClass, errorClass } from "../ui";
import { createServiceCall } from "./actions";

/** + New Service Call. On success it opens the report; a problem shows under the button. */
export default function NewServiceCallForm() {
  const [state, action] = useActionState(createServiceCall, null);
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <SubmitButton className={buttonClass} pendingText="Creating…">
        + New Service Call
      </SubmitButton>
      {state?.error && <p className={errorClass}>{state.error}</p>}
    </form>
  );
}
