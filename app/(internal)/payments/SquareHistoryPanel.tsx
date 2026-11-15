"use client";

import { useRef, useState } from "react";
import { buttonClass, buttonSecondaryClass, cardClass, errorClass, subTextClass } from "../ui";
import { runSquareHistoryImportStep } from "./history-actions";
import { describeHistoryProgress, type HistoryProgress } from "@/lib/square-history-map";

/**
 * Owner only. Count first, then copy every Square invoice, payment and refund
 * into the CRM. Runs in short steps from the browser, so keep the page open; if
 * it stops, Continue picks up where it left off.
 */
export default function SquareHistoryPanel() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<HistoryProgress | null>(null);
  const [preview, setPreview] = useState<HistoryProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef(false);

  async function run(dryRun: boolean, from: HistoryProgress | null) {
    setRunning(true);
    setError(null);
    stopRef.current = false;
    let current: HistoryProgress | null = from;
    try {
      for (;;) {
        const result = await runSquareHistoryImportStep({ dryRun, progress: current });
        if (result.progress) {
          current = result.progress;
          setProgress(current);
        }
        if (result.error) {
          setError(result.error);
          return;
        }
        if (!current || current.done) break;
        if (stopRef.current) {
          setError("Stopped. Press Continue to pick up where it stopped.");
          return;
        }
      }
      if (dryRun && current) setPreview(current);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Square history import failed. Press Continue to retry.");
    } finally {
      setRunning(false);
    }
  }

  const finished = progress?.done ?? false;
  const canContinue = !running && progress && !progress.done;

  return (
    <section className={`${cardClass} flex flex-col gap-3`}>
      <div>
        <h2 className="font-display text-lg font-bold text-white">Import full Square history</h2>
        <p className={subTextClass}>
          The regular sync only looks back a year. This reads every Square invoice (all locations), payment and
          refund since the account began and stores them here. Nothing is written to Square and no CRM invoice is
          changed. Customers link only where the CRM customer is already tied to that Square customer. Safe to run
          again. Keep this page open while it runs.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`${buttonSecondaryClass} disabled:opacity-50`}
          disabled={running}
          onClick={() => {
            setPreview(null);
            setProgress(null);
            void run(true, null);
          }}
        >
          {running && progress?.dryRun !== false ? "Counting…" : "Preview (count only)"}
        </button>
        {preview && !running && (
          <button type="button" className={buttonClass} onClick={() => void run(false, null)}>
            Import everything
          </button>
        )}
        {canContinue && (
          <button type="button" className={buttonSecondaryClass} onClick={() => void run(progress.dryRun, progress)}>
            Continue
          </button>
        )}
        {running && (
          <button type="button" className={buttonSecondaryClass} onClick={() => (stopRef.current = true)}>
            Stop
          </button>
        )}
      </div>

      {progress && (
        <p className="text-sm text-g300">
          {progress.dryRun ? "Square has" : finished ? "Imported" : "Importing"}: {describeHistoryProgress(progress)}
          {!finished && progress.totalTasks > 0 && ` · step ${Math.min(progress.taskIndex + 1, progress.totalTasks)} of ${progress.totalTasks}`}
          {finished && progress.dryRun && " · nothing saved yet"}
          {finished && !progress.dryRun && " · done"}
        </p>
      )}
      {error && <p className={errorClass}>{error}</p>}
    </section>
  );
}
