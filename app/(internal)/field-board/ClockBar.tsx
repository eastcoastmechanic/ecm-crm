"use client";

import { useActionState, useEffect, useState } from "react";
import SubmitButton from "../SubmitButton";
import { inputClass } from "../ui";
import { clockInAction, clockOutAction } from "./clock-actions";

const bar = "rounded-2xl border border-white/8 bg-white/3 p-4";
const bigButton =
  "w-full rounded-xl bg-gradient-to-br from-accent to-accent-2 px-4 py-4 text-base font-bold uppercase tracking-wide text-white shadow-[0_2px_8px_rgba(232,80,42,.3)] transition-opacity hover:opacity-90";
const calmButton =
  "w-full rounded-xl border border-white/8 bg-white/4 px-4 py-3 text-sm font-bold uppercase tracking-wide text-white transition-colors hover:bg-white/8";

function elapsed(startMs: number, nowMs: number) {
  const minutes = Math.max(0, Math.round((nowMs - startMs) / 60000));
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Day clock at the top of the truck screen: clock in, then clock out with a meal break when the shift is long. */
export default function ClockBar({ shiftStartedAt, sinceLabel }: { shiftStartedAt: string | null; sinceLabel: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!shiftStartedAt) return;
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [shiftStartedAt]);

  const [inState, inAction] = useActionState(async () => clockInAction(), null);
  const [outState, outAction] = useActionState(clockOutAction, null);

  if (!shiftStartedAt) {
    return (
      <div className={bar}>
        <div className="mb-2 text-xs font-bold uppercase tracking-wide text-g300">Not clocked in</div>
        <form action={inAction}>
          <SubmitButton className={bigButton} pendingText="Clocking in…">
            Clock in for the day
          </SubmitButton>
        </form>
        {inState?.error && <p className="mt-2 text-sm text-accent">{inState.error}</p>}
      </div>
    );
  }

  const longShift = now - new Date(shiftStartedAt).getTime() > 6 * 3600000;
  return (
    <div className={bar}>
      <div className="mb-2 text-xs font-bold uppercase tracking-wide text-g300">
        On the clock since {sinceLabel} ({elapsed(new Date(shiftStartedAt).getTime(), now)})
      </div>
      <form action={outAction} className="grid gap-2">
        {longShift && (
          <label className="grid gap-1 text-sm text-g300">
            Meal break today, in minutes (0 if none)
            <input name="break_minutes" type="number" min={0} max={480} inputMode="numeric" required className={inputClass} />
          </label>
        )}
        <SubmitButton className={calmButton} pendingText="Clocking out…">
          Clock out
        </SubmitButton>
      </form>
      {outState?.error && <p className="mt-2 text-sm text-accent">{outState.error}</p>}
    </div>
  );
}
