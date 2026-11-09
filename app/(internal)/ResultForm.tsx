"use client";

import { useState } from "react";
import { errorClass } from "./ui";

/**
 * A form for a server action that returns { error } (instead of throwing). Shows
 * the error under the fields, keeps what was typed (it submits by hand: React
 * resets uncontrolled fields after a form action, even a failed one), disables
 * the fields while saving, and calls onDone after a successful save.
 */
export default function ResultForm({
  submit,
  onDone,
  resetOnDone = false,
  className,
  children,
}: {
  submit: (formData: FormData) => Promise<{ error?: string } | void>;
  onDone?: () => void;
  /** Clear the fields after a successful save (for "add" forms). */
  resetOnDone?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <form
      className={className}
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const data = new FormData(form);
        setError("");
        setSaving(true);
        try {
          const result = await submit(data);
          if (result?.error) setError(result.error);
          else {
            if (resetOnDone) form.reset();
            onDone?.();
          }
        } catch {
          setError("Couldn't save. Try again.");
        } finally {
          setSaving(false);
        }
      }}
    >
      <fieldset disabled={saving} className="contents">
        {children}
      </fieldset>
      {error && (
        <p role="alert" className={`${errorClass} sm:col-span-2`}>
          {error}
        </p>
      )}
    </form>
  );
}
