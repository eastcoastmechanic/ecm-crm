"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { formatEtShortDateTime } from "@/lib/tz";
import { MAX_LOG_LENGTH, summaryLine, type LogSection } from "@/lib/running-log";
import { addLogEntry, setLogEntryFolded } from "./actions";
import { buttonClass, errorClass, inputClass, itemSubClass, subTextClass } from "../ui";

export type PickerOption = { id: string; label: string };

export type LogEntryView = {
  id: string;
  body: string;
  createdAt: string;
  folded: boolean;
  author: string | null;
  job: { id: string; label: string } | null;
  customer: { id: string; name: string } | null;
};

const smallButton =
  "rounded-lg border border-white/8 bg-white/4 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white transition-colors hover:bg-white/8 disabled:opacity-50";

function FoldButton({ id, folded }: { id: string; folded: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex shrink-0 items-center gap-2">
      {error && <span className={errorClass}>{error}</span>}
      <button
        type="button"
        disabled={pending}
        className={smallButton}
        onClick={() => {
          setError(null);
          start(async () => {
            try {
              const result = await setLogEntryFolded(id, !folded);
              if (result.error) setError(result.error);
            } catch {
              setError("Couldn't save. Try again.");
            }
          });
        }}
      >
        {pending ? "Saving…" : folded ? "Unfold" : "Fold"}
      </button>
    </span>
  );
}

function AddForm({
  section,
  label,
  jobOptions,
  customerOptions,
}: {
  section: LogSection;
  label: string;
  jobOptions?: PickerOption[];
  customerOptions?: PickerOption[];
}) {
  // Controlled fields, submitted by hand, so a failed save keeps what was typed.
  const [text, setText] = useState("");
  const [jobId, setJobId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [saving, start] = useTransition();

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setError(null);
        setWarning(null);
        start(async () => {
          try {
            const result = await addLogEntry(data);
            if (result.error) {
              setError(result.error);
              return;
            }
            setText("");
            setJobId("");
            setCustomerId("");
            if (result.warning) setWarning(result.warning);
          } catch {
            setError("Couldn't save. Try again.");
          }
        });
      }}
    >
      <input type="hidden" name="section" value={section} />
      <fieldset disabled={saving} className="contents">
        <textarea
          name="body"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          maxLength={MAX_LOG_LENGTH}
          placeholder={`Add to ${label}`}
          aria-label={`New ${label} entry`}
          className={inputClass}
        />
        {jobOptions && (
          <label className="flex flex-col gap-1 text-xs text-g300">
            Job (optional; the note also goes in that job&apos;s Notebook)
            <select name="job_id" value={jobId} onChange={(e) => setJobId(e.target.value)} className={inputClass}>
              <option value="">No job</option>
              {jobOptions.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {customerOptions && (
          <label className="flex flex-col gap-1 text-xs text-g300">
            Customer (optional)
            <select
              name="customer_id"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className={inputClass}
            >
              <option value="">No customer</option>
              {customerOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={!text.trim()} className={`${buttonClass} disabled:opacity-50`}>
            {saving ? "Saving…" : "Add"}
          </button>
          {error && (
            <span role="alert" className={errorClass}>
              {error}
            </span>
          )}
          {warning && (
            <span role="status" className="text-sm text-gold">
              {warning}
            </span>
          )}
        </div>
      </fieldset>
    </form>
  );
}

function EntryLinks({ entry }: { entry: LogEntryView }) {
  if (!entry.job && !entry.customer) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {entry.job && (
        <Link href={`/jobs?view=list#job-${entry.job.id}`} className="font-semibold text-accent">
          Job: {entry.job.label}
        </Link>
      )}
      {entry.customer && (
        <Link href={`/customers/${entry.customer.id}`} className="font-semibold text-accent">
          {entry.customer.name}
        </Link>
      )}
    </div>
  );
}

export default function LogSectionPanel({
  section,
  label,
  open,
  folded,
  olderOpenHref,
  olderFoldedHref,
  jobOptions,
  customerOptions,
}: {
  section: LogSection;
  label: string;
  open: LogEntryView[];
  folded: LogEntryView[];
  olderOpenHref: string | null;
  olderFoldedHref: string | null;
  jobOptions?: PickerOption[];
  customerOptions?: PickerOption[];
}) {
  const openCount = `${open.length}${olderOpenHref ? "+" : ""}`;
  const foldedCount = `${folded.length}${olderFoldedHref ? "+" : ""}`;
  return (
    <details id={`log-${section}`} open className="group scroll-mt-20 rounded-xl border border-white/8 bg-white/3">
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3">
        <span className="flex items-center gap-2 font-display text-lg font-extrabold tracking-wide">
          <span aria-hidden className="text-sm text-g300 transition-transform group-open:rotate-90">▶</span>
          {label}
        </span>
        <span className="rounded-full bg-white/8 px-2 py-0.5 text-xs font-bold text-g300">{openCount} open</span>
      </summary>

      <div className="flex flex-col gap-4 border-t border-white/8 px-4 py-3">
        <AddForm section={section} label={label} jobOptions={jobOptions} customerOptions={customerOptions} />

        {open.length === 0 ? (
          <p className={subTextClass}>Nothing open here.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-white/8">
            {open.map((entry) => (
              <li key={entry.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-g300">
                    {formatEtShortDateTime(entry.createdAt)} · {entry.author ?? "Staff"}
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-white">{entry.body}</p>
                  <EntryLinks entry={entry} />
                </div>
                <FoldButton id={entry.id} folded={false} />
              </li>
            ))}
          </ul>
        )}
        {olderOpenHref && (
          <Link href={olderOpenHref} className="text-sm font-semibold text-accent">
            Show older
          </Link>
        )}

        {folded.length > 0 && (
          <details className="rounded-lg border border-white/8 bg-white/2">
            <summary className={`cursor-pointer px-3 py-2 ${itemSubClass}`}>Folded ({foldedCount})</summary>
            <ul className="flex flex-col divide-y divide-white/8 px-3 pb-2">
              {folded.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-xs text-g300" title={entry.body}>
                    {formatEtShortDateTime(entry.createdAt)} · {summaryLine(entry.body)}
                  </span>
                  <FoldButton id={entry.id} folded />
                </li>
              ))}
            </ul>
            {olderFoldedHref && (
              <Link href={olderFoldedHref} className="block px-3 pb-2 text-sm font-semibold text-accent">
                Show older
              </Link>
            )}
          </details>
        )}
      </div>
    </details>
  );
}
