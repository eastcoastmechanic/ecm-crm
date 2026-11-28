"use client";

import { useActionState, useState, useTransition } from "react";
import SubmitButton from "../SubmitButton";
import { buttonClass, buttonSecondaryClass, errorClass, inputClass, itemSubClass, subTextClass } from "../ui";
import { createRundownPlanner, syncRundownNow, type RundownActionState } from "./rundown-actions";

export type RundownOverview = {
  tableMissing: boolean;
  planReady: boolean;
  groupMade: boolean;
  lastPullAt: string | null;
  lastError: string | null;
  latestRun: { bot: string; run_date: string; received_at: string; item_count: number } | null;
  openBySection: Record<string, number>;
  waitingToPush: number;
  pushErrors: number;
};

const SECTION_NAMES: Record<string, string> = {
  waiting: "Waiting on me",
  money: "Money / admin",
  next: "Next actions",
  conflict: "Conflicts",
  happened: "What happened",
};

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-US", {
        timeZone: "America/New_York",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "never";

export default function RundownCard({ overview, defaultSignIn }: { overview: RundownOverview; defaultSignIn: string }) {
  const [state, action] = useActionState<RundownActionState, FormData>(createRundownPlanner, null);
  const [syncState, setSyncState] = useState<RundownActionState>(null);
  const [syncing, startSync] = useTransition();

  if (overview.tableMissing) {
    return <p className={subTextClass}>Run SQL 0087 first, then this card turns on.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <p className={subTextClass}>
        Grok&apos;s nightly rundown as a Planner board only you can see (a private Microsoft 365 group with you as the
        only member, separate from the Jobs plan techs use). Grok posts it with its bot key; cards update in place,
        nothing piles up twice, and a card you complete stays complete.
      </p>

      {!overview.planReady ? (
        <form action={action} className="flex flex-col gap-2">
          <label className={itemSubClass} htmlFor="rundown-sign-in">
            Your Microsoft sign-in (the owner account to add as the only member)
          </label>
          <input
            id="rundown-sign-in"
            name="sign_in"
            type="email"
            className={inputClass}
            defaultValue={state?.signIn ?? defaultSignIn}
            disabled={overview.groupMade}
            placeholder="you@yourcompany.com"
          />
          <SubmitButton className={`${buttonClass} w-fit`} pendingText="Setting up… (up to a minute)">
            {overview.groupMade ? "Finish Daily Rundown planner" : "Create Daily Rundown planner"}
          </SubmitButton>
        </form>
      ) : (
        <p className="text-white">ECM Daily Rundown planner is set up.</p>
      )}
      {state?.error && (
        <p role="alert" className={errorClass}>
          {state.error}
        </p>
      )}
      {state?.message && <p className={itemSubClass}>{state.message}</p>}

      <div className="flex flex-col gap-1">
        <div className={itemSubClass}>
          Latest run:{" "}
          {overview.latestRun
            ? `${overview.latestRun.run_date} from ${overview.latestRun.bot}, ${overview.latestRun.item_count} items, received ${when(overview.latestRun.received_at)}`
            : "none yet"}
        </div>
        <div className={itemSubClass}>
          Open:{" "}
          {Object.keys(SECTION_NAMES)
            .map((s) => `${SECTION_NAMES[s]} ${overview.openBySection[s] ?? 0}`)
            .join(" · ")}
        </div>
        {overview.planReady && (
          <div className={itemSubClass}>
            Last read from Planner: {when(overview.lastPullAt)}. Waiting to write: {overview.waitingToPush}
            {overview.pushErrors > 0 ? `, ${overview.pushErrors} with errors (retried hourly)` : ""}.
          </div>
        )}
        {overview.lastError && <p className={errorClass}>{overview.lastError}</p>}
      </div>

      {overview.planReady && (
        <button
          type="button"
          disabled={syncing}
          className={`${buttonSecondaryClass} w-fit`}
          onClick={() =>
            startSync(async () => {
              setSyncState(await syncRundownNow());
            })
          }
        >
          {syncing ? "Syncing…" : "Sync with Planner now"}
        </button>
      )}
      {syncState?.error && <p className={errorClass}>{syncState.error}</p>}
      {syncState?.message && <p className={itemSubClass}>{syncState.message}</p>}
    </div>
  );
}
