"use client";

import { useMemo, useState } from "react";
import { finishServiceReport } from "./actions";
import SubmitButton from "../../SubmitButton";
import { buttonClass, inputClass, itemSubClass } from "../../ui";

export default function FinishReportForm({ diagnosticId }: { diagnosticId: string }) {
  const [startedAt, setStartedAt] = useState("");
  const [endedAt, setEndedAt] = useState("");

  const hours = useMemo(() => {
    if (!startedAt || !endedAt) return null;
    const start = new Date(startedAt).getTime();
    const end = new Date(endedAt).getTime();
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
    return Math.round(((end - start) / 3600000) * 100) / 100;
  }, [startedAt, endedAt]);

  return (
    <form action={finishServiceReport} className="flex flex-col gap-3">
      <input type="hidden" name="diagnostic_id" value={diagnosticId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-g300">
          Time started
          <input
            type="datetime-local"
            name="time_started_at"
            value={startedAt}
            onChange={(e) => setStartedAt(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-g300">
          Time ended
          <input
            type="datetime-local"
            name="time_ended_at"
            value={endedAt}
            onChange={(e) => setEndedAt(e.target.value)}
            className={inputClass}
          />
        </label>
      </div>
      {hours !== null && <p className={itemSubClass}>Time tracked: {hours} hrs</p>}

      <label className="flex items-start gap-2 text-xs text-g300">
        <input type="checkbox" name="create_invoice" defaultChecked className="mt-0.5" />
        <span>
          Create an invoice from the parts used above (and labor, if a shop hourly rate is configured) when I
          finish this report.
        </span>
      </label>

      <SubmitButton className={`${buttonClass} w-fit`} pendingText="Finishing…">
        Finish Service Call
      </SubmitButton>
    </form>
  );
}
