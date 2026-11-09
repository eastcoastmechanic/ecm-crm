"use client";

import { useActionState, useEffect, useState } from "react";
import SubmitButton from "../SubmitButton";
import { inputClass } from "../ui";
import { clockInAction, clockOutAction } from "./clock-actions";
import { formatHm, formatHmShort, withOpenShift, type ClockWeek } from "@/lib/clock-week";

const bar = "rounded-2xl border border-white/8 bg-white/3 p-4";
const bigButton =
  "w-full rounded-xl bg-gradient-to-br from-accent to-accent-2 px-4 py-4 text-base font-bold uppercase tracking-wide text-white shadow-[0_2px_8px_rgba(232,80,42,.3)] transition-opacity hover:opacity-90";
const calmButton =
  "w-full rounded-xl border border-white/8 bg-white/4 px-4 py-3 text-sm font-bold uppercase tracking-wide text-white transition-colors hover:bg-white/8";

function elapsed(startMs: number, nowMs: number) {
  const minutes = Math.max(0, Math.round((nowMs - startMs) / 60000));
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Week total (big), today, and a day row Mon..today. Same week and rules as payroll on /hours. */
function Totals({ week }: { week: ClockWeek }) {
  const soFar = week.days.filter((d) => d.dateKey <= week.todayKey);
  return (
    <div className="mb-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-g300">This week</div>
          <div className="text-3xl font-extrabold leading-tight text-white tabular-nums" suppressHydrationWarning>{formatHm(week.weekHours)}</div>
        </div>
        <div className="text-right">
          <div className="text-[11px] font-bold uppercase tracking-wide text-g300">Today</div>
          <div className="text-lg font-bold text-white tabular-nums" suppressHydrationWarning>{formatHm(week.todayHours)}</div>
        </div>
      </div>
      {soFar.length > 0 && (
        <div className="mt-1 text-xs text-g300 tabular-nums">
          {soFar.map((d, i) => (
            <span key={d.dateKey}>
              {i > 0 && " · "}
              {d.label} {d.hours > 0 ? formatHmShort(d.hours) : "—"}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Day clock at the top of the truck screen: clock in, then clock out with a meal break when the shift is long.
 * Shows today's and this week's hours for the signed-in person. `finishedWeek` holds finished shifts only
 * (from the server); the running shift is added here and ticks with the 30 second timer, no extra requests.
 */
export default function ClockBar({
  shiftStartedAt,
  sinceLabel,
  finishedWeek,
}: {
  shiftStartedAt: string | null;
  sinceLabel: string | null;
  finishedWeek: ClockWeek | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  // Ticks while clocked out too, so a page left open past Monday 00:00 ET resets the week. Local only, no requests.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const [inState, inAction] = useActionState(async () => clockInAction(), null);
  const [outState, outAction] = useActionState(clockOutAction, null);

  const week = finishedWeek ? withOpenShift(finishedWeek, shiftStartedAt, new Date(now)) : null;

  if (!shiftStartedAt) {
    return (
      <div className={bar}>
        <div className="mb-2 text-xs font-bold uppercase tracking-wide text-g300">Not clocked in</div>
        {week && <Totals week={week} />}
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
      <div className="mb-2 text-xs font-bold uppercase tracking-wide text-g300" suppressHydrationWarning>
        On the clock since {sinceLabel} ({elapsed(new Date(shiftStartedAt).getTime(), now)})
      </div>
      {week && <Totals week={week} />}
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
