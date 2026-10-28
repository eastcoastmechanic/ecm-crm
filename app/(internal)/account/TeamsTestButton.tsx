"use client";

import { useState, useTransition } from "react";
import { buttonSecondaryClass, errorClass, itemSubClass } from "../ui";
import { sendTeamsTest } from "./actions";

type Result = { label: string; status: "sent" | "failed" | "not set" };

export default function TeamsTestButton() {
  const [pending, startTransition] = useTransition();
  const [results, setResults] = useState<Result[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        disabled={pending}
        className={`${buttonSecondaryClass} w-fit`}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            try {
              setResults((await sendTeamsTest()).results);
            } catch (e) {
              setResults(null);
              setError(e instanceof Error ? e.message : "Test failed");
            }
          })
        }
      >
        {pending ? "Sending…" : "Send Teams test"}
      </button>
      {error && <p className={errorClass}>{error}</p>}
      {results && (
        <ul className="flex flex-col gap-1">
          {results.map((r) => (
            <li key={r.label} className={itemSubClass}>
              {r.label}: {r.status}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
