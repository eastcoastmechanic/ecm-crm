"use client";

import SubmitButton from "../SubmitButton";
import { pauseJobAction, resumeJobAction } from "./clock-actions";
import { effectiveStep, itemsForJob, serverStep, type QueuedAction } from "@/lib/offline-queue";
import { queueTap, removeTap, retryTap, useOfflineQueue } from "./offline-store";

const bigButton =
  "w-full rounded-xl bg-gradient-to-br from-accent to-accent-2 px-4 py-4 text-base font-bold uppercase tracking-wide text-white shadow-[0_2px_8px_rgba(232,80,42,.3)] transition-opacity hover:opacity-90";

const linkButton =
  "flex flex-1 items-center justify-center rounded-xl border border-white/8 bg-white/4 px-4 py-3 text-sm font-bold uppercase tracking-wide text-white transition-colors hover:bg-white/8";

const smallButton =
  "rounded-lg border border-white/20 px-2 py-1 text-xs font-bold uppercase tracking-wide text-white hover:bg-white/8";

export type TruckStepJob = {
  id: string;
  status: string;
  on_way_at: string | null;
  timer?: "running" | "paused" | null;
  blockers?: string[];
};

function label(item: QueuedAction) {
  if (item.type === "on_way") return "On my way";
  if (item.type === "arrive") return "I'm here";
  if (item.type === "finish") return "Finish job";
  const body = item.payload.body ?? "";
  return `Note: ${body.length > 40 ? `${body.slice(0, 40)}…` : body}`;
}

function at(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
}

/**
 * One step at a time: On my way -> I'm here -> Finish job, with Pause / Resume above Finish.
 * Every tap is saved on the phone first and sent from there (offline-store.ts), so a tap with
 * no signal waits on the phone and sends itself later. The card moves on right away.
 */
export default function TruckStep({ job }: { job: TruckStepJob }) {
  const queue = useOfflineQueue();
  const waiting = itemsForJob(queue.items, job.id).filter((i) => i.staffKey === queue.staffKey);
  const sent = queue.sent.filter((i) => i.jobId === job.id);
  const step = effectiveStep(serverStep(job), [...waiting, ...sent]);
  const flash = queue.flash[job.id];
  // Pause / Resume are live server calls: only with signal and nothing waiting on this job.
  const canUseTimer = queue.online && waiting.length === 0 && sent.length === 0 && job.status === "in_progress";
  const blockers = job.blockers ?? [];

  return (
    <div className="flex flex-col gap-2">
      {step === "finish" && canUseTimer && job.timer === "running" && (
        <form action={pauseJobAction}>
          <input type="hidden" name="id" value={job.id} />
          <SubmitButton className={linkButton} pendingText="Pausing…">
            Pause timer
          </SubmitButton>
        </form>
      )}
      {step === "finish" && canUseTimer && job.timer === "paused" && (
        <form action={resumeJobAction}>
          <input type="hidden" name="id" value={job.id} />
          <SubmitButton className={linkButton} pendingText="Resuming…">
            Timer paused. Resume
          </SubmitButton>
        </form>
      )}
      {step === "finish" && blockers.length > 0 && !flash && (
        <p className="text-sm text-g300">Before you finish: {blockers.join(" ")}</p>
      )}
      {flash && <p className="text-sm text-accent">{flash}</p>}

      {step === "on_way" && (
        <button type="button" className={bigButton} onClick={() => void queueTap("on_way", job.id)}>
          On my way
        </button>
      )}
      {step === "arrive" && (
        <button type="button" className={bigButton} onClick={() => void queueTap("arrive", job.id)}>
          I&apos;m here
        </button>
      )}
      {step === "finish" && (
        <button type="button" className={bigButton} onClick={() => void queueTap("finish", job.id)}>
          Finish job
        </button>
      )}

      {waiting.length > 0 && (
        <ul className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/3 p-3 text-sm">
          {waiting.map((item) => (
            <li key={item.clientActionId} className="flex flex-col gap-1">
              <div className="font-semibold text-white">
                {label(item)} <span className="font-normal text-g300">· tapped {at(item.createdAt)}</span>
              </div>
              {item.state === "refused" ? (
                <>
                  <p className="text-accent">Not saved: {item.error}</p>
                  <div className="flex gap-2">
                    <button type="button" className={smallButton} onClick={() => void retryTap(item.clientActionId)}>
                      Try again
                    </button>
                    <button
                      type="button"
                      className={smallButton}
                      onClick={() => {
                        if (window.confirm(`Remove "${label(item)}"? It will not be sent.`)) void removeTap(item.clientActionId);
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </>
              ) : item.savedOffline || item.attempts > 0 || !queue.online ? (
                <p className="text-g300">Saved on phone — will send when you have signal.</p>
              ) : (
                <p className="text-g300">Sending…</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
