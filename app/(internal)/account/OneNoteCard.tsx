"use client";

import { useState, useTransition } from "react";
import { buttonClass, buttonSecondaryClass, errorClass, itemSubClass, subTextClass } from "../ui";
import { disconnectOneNote } from "./actions";

const RESULT_TEXT: Record<string, string> = {
  connected: "Connected. New job notes will be copied to OneNote.",
  cancelled: "Sign-in was cancelled. Nothing changed.",
  expired: "That sign-in took too long or came from another tab. Try Connect again.",
  not_allowed: "Only the owner can connect OneNote.",
  not_configured: "The Microsoft app isn't set up on this site (MS_GRAPH_* settings).",
};

export default function OneNoteCard({
  connected,
  account,
  connectedAt,
  lastError,
  result,
}: {
  connected: boolean;
  account: string | null;
  connectedAt: string | null;
  lastError: string | null;
  result: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const resultText = result ? (RESULT_TEXT[result] ?? `Microsoft said: ${result}. Check the app registration steps.`) : null;

  return (
    <div className="flex flex-col gap-3">
      <p className={subTextClass}>
        Copies each job note to the shared &ldquo;ECM Jobs&rdquo; OneNote notebook in the ecmjobs site: a section per
        address, a page per job. The CRM keeps the notes either way.
      </p>
      {resultText && <p className={result === "connected" ? itemSubClass : errorClass}>{resultText}</p>}
      {connected ? (
        <>
          <p className="text-white">
            Connected as {account ?? "your Microsoft account"}
            {connectedAt && (
              <span className={itemSubClass}>
                {" "}
                since{" "}
                {new Date(connectedAt).toLocaleDateString("en-US", {
                  timeZone: "America/New_York",
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
            )}
          </p>
          {lastError && <p className={errorClass}>{lastError}</p>}
          <div className="flex flex-wrap gap-2">
            <a href="/api/microsoft/connect" className={`${buttonSecondaryClass} w-fit`}>
              Reconnect
            </a>
            <button
              type="button"
              disabled={pending}
              className={`${buttonSecondaryClass} w-fit`}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const res = await disconnectOneNote();
                  if (res.error) setError(res.error);
                })
              }
            >
              {pending ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        </>
      ) : (
        <a href="/api/microsoft/connect" className={`${buttonClass} w-fit`}>
          Connect OneNote
        </a>
      )}
      {error && <p className={errorClass}>{error}</p>}
    </div>
  );
}
