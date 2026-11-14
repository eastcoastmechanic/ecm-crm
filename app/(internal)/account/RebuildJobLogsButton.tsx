"use client";

import { useState, useTransition } from "react";
import { buttonSecondaryClass, errorClass, itemSubClass } from "../ui";
import { rebuildJobLogsAction, type RebuildLogsResult } from "./job-log-actions";

export default function RebuildJobLogsButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<RebuildLogsResult | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={pending}
        className={`${buttonSecondaryClass} w-fit disabled:opacity-50`}
        onClick={() =>
          startTransition(async () => {
            try {
              setResult(await rebuildJobLogsAction());
            } catch {
              setResult({ error: "Couldn't reach the server. Try again." });
            }
          })
        }
      >
        {pending ? "Writing…" : "Rebuild job logs"}
      </button>
      {result?.error && <p className={errorClass}>{result.error}</p>}
      {result?.message && <p className={itemSubClass}>{result.message}</p>}
    </div>
  );
}
