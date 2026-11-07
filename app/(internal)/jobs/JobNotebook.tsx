"use client";

import { useState, useTransition } from "react";
import { addJobNote, loadJobNotebook, type NotebookState } from "./notebook-actions";
import { buttonClass, buttonSecondaryClass, errorClass, inputClass, itemSubClass, subTextClass } from "../ui";

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
}: {
  jobId: string;
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<NotebookState | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();
  const [saving, startSave] = useTransition();

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      startLoad(async () => {
        setState(await loadJobNotebook(jobId));
      });
    }
  }

  function save() {
    setError(null);
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

          {state && !state.error && state.notes.length === 0 && <p className={subTextClass}>No notes on this job yet.</p>}
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
