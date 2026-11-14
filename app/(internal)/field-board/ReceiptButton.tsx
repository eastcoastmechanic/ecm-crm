"use client";

import { startTransition, useActionState, useState } from "react";
import { downscaleImage } from "@/lib/downscale-image";
import { addJobReceipt, type AddReceiptState } from "../jobs/file-actions";

const field = "w-full rounded-xl border border-white/8 bg-white/4 px-3 py-3 text-base text-white outline-none focus:border-accent";

/**
 * Truck card: snap a receipt and type what it cost, so the office can bill it. After saving, the
 * tech sees only "Saved" and how many receipts the job has: no list, no amounts. The amount
 * typed here goes straight to the office.
 */
export default function ReceiptButton({
  jobId,
  buttonClassName,
  initialCount,
}: {
  jobId: string;
  buttonClassName: string;
  initialCount: number;
}) {
  const [state, action, pending] = useActionState<AddReceiptState, FormData>(addJobReceipt, null);
  // The form is open against the result it was opened with; a new "saved" result closes it.
  const [openedWith, setOpenedWith] = useState<AddReceiptState | undefined>(undefined);
  const open = openedWith !== undefined && (state === openedWith || !state?.saved);
  const count = state?.count ?? initialCount;
  const [offline, setOffline] = useState(false);

  async function submit(formData: FormData) {
    // Receipts are not kept on the phone for later: they need signal.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setOffline(true);
      return;
    }
    setOffline(false);
    const file = formData.get("file");
    if (file instanceof File && file.type.startsWith("image/")) formData.set("file", await downscaleImage(file));
    startTransition(() => action(formData));
  }

  return (
    <div>
      <button type="button" onClick={() => setOpenedWith(open ? undefined : state)} className={buttonClassName} aria-expanded={open}>
        {open ? "Close receipt" : `Add receipt${count > 0 ? ` · ${count} on job` : ""}`}
      </button>
      {state?.saved && !open && <p className="mt-1 text-sm text-g300">Receipt saved. The office has it.</p>}
      {open && (
        <form key={state?.error ? JSON.stringify(state.typed) : "new"} action={submit} className="mt-2 flex flex-col gap-2 rounded-xl border border-white/8 bg-white/3 p-3">
          <input type="hidden" name="job_id" value={jobId} />
          <label className="text-xs font-bold uppercase tracking-wide text-g300">
            Receipt photo
            <input type="file" name="file" accept="image/*,application/pdf" capture="environment" required className="mt-1 block text-sm text-g300" />
          </label>
          <input name="vendor" required maxLength={80} defaultValue={state?.typed?.vendor} placeholder="Where (vendor)" aria-label="Vendor" className={field} />
          <input name="amount" required inputMode="decimal" defaultValue={state?.typed?.amount} placeholder="Amount paid, like 42.18" aria-label="Amount paid" className={field} />
          <input name="note" maxLength={300} defaultValue={state?.typed?.note} placeholder="What it was for (optional)" aria-label="Note" className={field} />
          <button type="submit" disabled={pending} className={`${buttonClassName} disabled:opacity-50`}>
            {pending ? "Saving…" : "Save receipt"}
          </button>
          {offline && <p className="text-sm text-accent">Receipts need signal. Keep the paper and add it when you&apos;re back online.</p>}
          {state?.error && <p className="text-sm text-accent">{state.error}</p>}
        </form>
      )}
    </div>
  );
}
