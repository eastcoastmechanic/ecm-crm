"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recalculateDraftInvoice, type RecalculateState } from "./invoice-actions";
import { buttonSecondaryClass, errorClass, subTextClass } from "../ui";

/**
 * Office: rebuild a job's draft invoice from the job (labor, receipts with markup, or the
 * contract balance). Asks first, since it replaces hand edits on the draft. The server refuses
 * anything already sent or paid.
 */
export default function RecalcDraftButton({ jobId, compact = false }: { jobId: string; compact?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<RecalculateState | null>(null);

  function run() {
    if (!window.confirm("Rebuild the draft's lines from the job's clocked time and receipts? Edits you made on the draft are replaced.")) return;
    start(async () => {
      try {
        const r = await recalculateDraftInvoice(jobId);
        setResult(r);
        if (!r.error) router.refresh();
      } catch {
        setResult({ error: "Couldn't reach the server. Try again." });
      }
    });
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className={compact ? "underline disabled:opacity-50" : `${buttonSecondaryClass} disabled:opacity-50`}
      >
        {pending ? "Recalculating…" : "Recalculate draft"}
      </button>
      {result?.error && <span className={errorClass}>{result.error}</span>}
      {result?.message && <span className={subTextClass}>{result.message}</span>}
    </span>
  );
}
