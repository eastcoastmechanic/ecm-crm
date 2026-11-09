"use client";

import ResultForm from "../ResultForm";
import { buttonSecondaryClass } from "../ui";
import { formatEtTime } from "@/lib/tz";
import { pauseTechTimer, resumeTechTimer } from "./time-actions";

export type JobTimerView = { staffId: string; name: string; state: "running" | "paused"; since: string };

/** Each tech's running or paused work timer on this job, with Pause / Resume for the office. */
export default function JobTimers({ jobId, timers }: { jobId: string; timers: JobTimerView[] }) {
  if (timers.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      {timers.map((t) => (
        <ResultForm
          key={t.staffId}
          submit={t.state === "running" ? pauseTechTimer : resumeTechTimer}
          className="flex flex-wrap items-center gap-2 text-sm"
        >
          <input type="hidden" name="job_id" value={jobId} />
          <input type="hidden" name="staff_id" value={t.staffId} />
          <span className="text-white">
            {t.name}:{" "}
            {t.state === "running" ? (
              <span className="text-green">timer running since {formatEtTime(t.since)}</span>
            ) : (
              <span className="text-gold">paused at {formatEtTime(t.since)}</span>
            )}
          </span>
          <button className={buttonSecondaryClass}>{t.state === "running" ? "Pause" : "Resume"}</button>
        </ResultForm>
      ))}
    </div>
  );
}
