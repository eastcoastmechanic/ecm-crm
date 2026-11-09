"use client";

import { startTransition, useActionState } from "react";

export type ActionFormState = { error?: string } | null;

/**
 * A form for a server action that returns { error }. Shows the error under the
 * fields and keeps what was typed: it submits by hand instead of through the
 * action prop, because React resets uncontrolled fields after an action, even
 * a failed one. While saving, the fields and buttons are disabled.
 *
 * The action can be passed straight from a server component.
 */
export default function ActionForm<S extends ActionFormState>({
  action,
  className,
  errorClassName = "text-sm text-accent",
  children,
}: {
  action: (prev: S | null, formData: FormData) => Promise<S | null>;
  className?: string;
  errorClassName?: string;
  children: React.ReactNode;
}) {
  const [state, dispatch, pending] = useActionState<S | null, FormData>(action, null);
  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => dispatch(data));
      }}
    >
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
      {state?.error && (
        <p role="alert" className={errorClassName}>
          {state.error}
        </p>
      )}
    </form>
  );
}
