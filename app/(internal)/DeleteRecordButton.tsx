"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorClass } from "./ui";

export default function DeleteRecordButton({
  label,
  confirmMessage,
  onDelete,
  redirectTo,
}: {
  label: string;
  confirmMessage: string;
  onDelete: () => Promise<{ error?: string }>;
  redirectTo: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (!window.confirm(confirmMessage)) return;
    setError(null);
    setPending(true);
    try {
      const result = await onDelete();
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push(redirectTo);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-2 text-xs font-bold uppercase tracking-wide text-accent transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {pending ? "Deleting…" : label}
      </button>
      {error && <p className={errorClass}>{error}</p>}
    </div>
  );
}
