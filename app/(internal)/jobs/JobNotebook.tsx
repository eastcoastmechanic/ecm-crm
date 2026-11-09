"use client";

import { useEffect, useState, useTransition } from "react";
import { addJobNote, loadJobNotebook, type NotebookState } from "./notebook-actions";
import { buttonClass, buttonSecondaryClass, errorClass, inputClass, itemSubClass, subTextClass } from "../ui";
import { queueTap, useOfflineQueue } from "../field-board/offline-store";

const EMPTY_NOTEBOOK: NotebookState = { notes: [], folderUrl: null, folderName: null, folderNote: null, oneNoteUrl: null };

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Notebook for one job: the notes written on it and a link to the SharePoint folder for its
 * address. Loads when opened, so the Jobs list does not fetch notes for every row.
 * Used on the Jobs page (office) and the truck card (tech). No money fields.
 */
export default function JobNotebook({
  jobId,
  buttonClassName = buttonSecondaryClass,
  queueOnPhone = false,
}: {
  jobId: string;
  buttonClassName?: string;
  /** Truck screen: notes are saved on the phone first and sent from there, so they work with no signal. */
  queueOnPhone?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<NotebookState | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();
  const [saving, startSave] = useTransition();
  const queue = useOfflineQueue();
  const waitingNotes = queueOnPhone
    ? queue.items.filter((i) => i.jobId === jobId && i.type === "note" && i.staffKey === queue.staffKey)
    : [];

  function load() {
    startLoad(async () => {
      try {
        setState(await loadJobNotebook(jobId));
      } catch {
        // No signal: the notes can't load, but a new note can still be saved on the phone.
        setState({ ...EMPTY_NOTEBOOK, error: "No signal. Notes load when you're back online. You can still add one." });
      }
    });
  }

  // A note that just reached the server: reload so it shows with the others.
  const sentVersion = queue.sentVersion;
  useEffect(() => {
    if (queueOnPhone && open && sentVersion > 0) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when a queued note is sent
  }, [sentVersion]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) load();
  }

  function save() {
    setError(null);
    if (queueOnPhone) {
      const body = text.trim();
      if (!body) return;
      setText("");
      void queueTap("note", jobId, { body });
      return;
    }
    startSave(async () => {
      const result = await addJobNote(jobId, text);
      if (result.error || !result.note) {
        setError(result.error ?? "Could not save the note.");
        return;
      }
      const note = result.note;
      setText("");
      setState((prev) => ({
        folderUrl: null,
        folderName: null,
        folderNote: null,
        oneNoteUrl: null,
        ...prev,
        error: undefined,
        notes: [note, ...(prev?.notes ?? [])],
      }));
    });
  }

  return (
    <div className="w-full">
      <button type="button" onClick={toggle} className={buttonClassName} aria-expanded={open}>
        {open ? "Hide notebook" : "Notebook"}
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-3 rounded-xl border border-white/8 bg-white/3 p-3">
          {loading && !state && <p className={subTextClass}>Loading…</p>}
          {state?.error && <p className={errorClass}>{state.error}</p>}

          {state && (
            <div className="flex flex-wrap items-center gap-2">
              {state.folderUrl ? (
                <a href={state.folderUrl} target="_blank" rel="noreferrer" className={buttonSecondaryClass}>
                  Open folder
                </a>
              ) : (
                state.folderNote && <p className={itemSubClass}>{state.folderNote}</p>
              )}
              {state.folderUrl && state.folderName && <span className={itemSubClass}>{state.folderName}</span>}
              {state.oneNoteUrl && (
                <a href={state.oneNoteUrl} target="_blank" rel="noreferrer" className={buttonSecondaryClass}>
                  Open in OneNote
                </a>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              maxLength={4000}
              placeholder="Add a note for this job"
              className={inputClass}
              aria-label="Job note"
            />
            <div className="flex items-center gap-3">
              <button type="button" onClick={save} disabled={saving || !text.trim()} className={`${buttonClass} disabled:opacity-50`}>
                {saving ? "Saving…" : "Add note"}
              </button>
              {error && <span className={errorClass}>{error}</span>}
            </div>
          </div>

          {waitingNotes.length > 0 && (
            <ul className="flex flex-col divide-y divide-white/8">
              {waitingNotes.map((n) => (
                <li key={n.clientActionId} className="py-2">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-g300">
                    {n.state === "refused" ? `Not saved: ${n.error}` : "Saved on phone — will send when you have signal"} · {when(n.createdAt)}
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm text-white">{n.payload.body}</p>
                </li>
              ))}
            </ul>
          )}

          {state && !state.error && state.notes.length === 0 && waitingNotes.length === 0 && (
            <p className={subTextClass}>No notes on this job yet.</p>
          )}
          {state && state.notes.length > 0 && (
            <ul className="flex flex-col divide-y divide-white/8">
              {state.notes.map((n) => (
                <li key={n.id} className="py-2">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-g300">
                    {n.author_name ?? "Office"} · {when(n.created_at)}
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm text-white">{n.body}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
