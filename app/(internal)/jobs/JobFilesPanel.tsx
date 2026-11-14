"use client";

import { startTransition, useActionState, useEffect, useRef, useState, useTransition } from "react";
import { downscaleImage } from "@/lib/downscale-image";
import {
  addJobReceipt,
  loadOfficeJobFiles,
  removePhoto,
  removeReceipt,
  retryJobFileCopies,
  type AddReceiptState,
  type OfficeFilesState,
} from "./file-actions";
import { formatMoney } from "@/lib/job-invoice-rules";
import { buttonClass, buttonSecondaryClass, errorClass, inputClass, itemSubClass, subTextClass } from "../ui";

/**
 * Office/owner panel for one job: receipts (add, list with amounts, delete), delete for photos,
 * and how the copies to the job's SharePoint folder stand, with Retry. Loads when opened.
 * Every action here checks the office role on the server; a tech never sees this panel.
 */
export default function JobFilesPanel({ jobId }: { jobId: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<OfficeFilesState | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();
  const [busy, startBusy] = useTransition();
  const [added, addAction, adding] = useActionState<AddReceiptState, FormData>(addJobReceipt, null);
  const formRef = useRef<HTMLFormElement>(null);

  function load() {
    startLoad(async () => {
      try {
        setState(await loadOfficeJobFiles(jobId));
      } catch {
        setState({ error: "Couldn't load. Check your connection.", receipts: [], photos: [], copyLine: null, canRetry: false });
      }
    });
  }

  // A receipt was saved: clear the form and reload the list.
  useEffect(() => {
    if (added?.saved) {
      formRef.current?.reset();
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only after a save
  }, [added]);

  // Phone photos are shrunk in the browser first: a request body over 4.5 MB never arrives.
  async function submitReceipt(formData: FormData) {
    const file = formData.get("file");
    if (file instanceof File && file.type.startsWith("image/")) formData.set("file", await downscaleImage(file));
    startTransition(() => addAction(formData));
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) load();
  }

  function run(fn: () => Promise<{ error?: string }>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setActionError(null);
    startBusy(async () => {
      const result = await fn();
      if (result.error) setActionError(result.error);
      else load();
    });
  }

  function retry() {
    setActionError(null);
    startBusy(async () => {
      const result = await retryJobFileCopies(jobId);
      if (result.error) setActionError(result.error);
      load();
    });
  }

  const total = (state?.receipts ?? []).reduce((sum, r) => sum + (r.amount_cents ?? 0), 0);

  return (
    <div className="w-full">
      <button type="button" onClick={toggle} className={buttonSecondaryClass} aria-expanded={open}>
        {open ? "Hide receipts and files" : "Receipts and files"}
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-3 rounded-xl border border-white/8 bg-white/3 p-3">
          {loading && !state && <p className={subTextClass}>Loading…</p>}
          {state?.error && <p className={errorClass}>{state.error}</p>}
          {actionError && <p className={errorClass}>{actionError}</p>}

          <form ref={formRef} key={added?.error ? JSON.stringify(added.typed) : "new"} action={submitReceipt} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="job_id" value={jobId} />
            <label className="flex flex-col gap-0.5 text-[10px] text-g300">
              Receipt (photo or PDF)
              <input
                type="file"
                name="file"
                accept="image/*,application/pdf"
                required
                className="text-xs text-g300 file:mr-2 file:rounded file:border-0 file:bg-white/8 file:px-2 file:py-1 file:text-xs file:text-white"
              />
            </label>
            <label className="flex flex-col gap-0.5 text-[10px] text-g300">
              Vendor
              <input name="vendor" defaultValue={added?.typed?.vendor} required maxLength={80} placeholder="Supply house" className={inputClass} />
            </label>
            <label className="flex flex-col gap-0.5 text-[10px] text-g300">
              Amount paid
              <input name="amount" defaultValue={added?.typed?.amount} required inputMode="decimal" placeholder="0.00" className={`${inputClass} w-28`} />
            </label>
            <label className="flex flex-col gap-0.5 text-[10px] text-g300">
              Date
              <input name="purchased_on" type="date" defaultValue={added?.typed?.purchased_on} className={inputClass} />
            </label>
            <label className="flex min-w-48 flex-1 flex-col gap-0.5 text-[10px] text-g300">
              Note
              <input name="note" defaultValue={added?.typed?.note} maxLength={300} placeholder="What it was for" className={inputClass} />
            </label>
            <button type="submit" disabled={adding} className={`${buttonClass} disabled:opacity-50`}>
              {adding ? "Saving…" : "Add receipt"}
            </button>
          </form>
          {added?.error && <p className={errorClass}>{added.error}</p>}

          {state && state.receipts.length > 0 && (
            <ul className="flex flex-col divide-y divide-white/8">
              {state.receipts.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-2">
                  {r.url && r.content_type?.startsWith("image/") ? (
                    <a href={r.url} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={r.url} alt={`Receipt from ${r.vendor}`} className="h-12 w-12 rounded object-cover" />
                    </a>
                  ) : r.url ? (
                    <a href={r.url} target="_blank" rel="noreferrer" className="flex h-12 w-12 items-center justify-center rounded bg-white/8 text-[10px] font-bold text-white">
                      PDF
                    </a>
                  ) : (
                    <span className="flex h-12 w-12 items-center justify-center rounded bg-white/8 text-[10px] text-g300">?</span>
                  )}
                  <div className="flex-1">
                    <div className="text-sm text-white">
                      {r.vendor} · {r.amount_cents != null ? formatMoney(r.amount_cents) : "no amount"}
                    </div>
                    <div className={itemSubClass}>
                      {[r.purchased_on, r.note, r.uploaded_by_name ? `added by ${r.uploaded_by_name}` : null].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => removeReceipt(r.id), `Delete the ${r.vendor} receipt? This also removes its copy in SharePoint.`)}
                    className={`${subTextClass} underline disabled:opacity-50`}
                  >
                    Delete
                  </button>
                </li>
              ))}
              <li className={`py-2 ${itemSubClass}`}>Receipts total {formatMoney(total)} (before markup).</li>
            </ul>
          )}
          {state && !state.error && state.receipts.length === 0 && <p className={subTextClass}>No receipts on this job yet.</p>}

          {state && state.photos.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className={itemSubClass}>Photos (delete removes the CRM copy and the SharePoint copy):</p>
              <div className="flex flex-wrap gap-2">
                {state.photos.map((p) => (
                  <div key={p.path} className="flex flex-col items-center gap-1">
                    {p.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.url} alt="Job photo" title={p.phase ?? undefined} className="h-16 w-16 rounded-lg object-cover" />
                    ) : (
                      <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-white/8 text-[10px] text-g300">missing</span>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(() => removePhoto(jobId, p.path), "Delete this photo? This also removes its copy in SharePoint.")}
                      className="text-[10px] text-g300 underline disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {state?.copyLine && (
            <div className="flex flex-wrap items-center gap-2">
              <span className={itemSubClass}>{state.copyLine}</span>
              {state.canRetry && (
                <button type="button" onClick={retry} disabled={busy} className={`${buttonSecondaryClass} disabled:opacity-50`}>
                  {busy ? "Working…" : "Retry copy"}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
