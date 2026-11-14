"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import SubmitButton from "../SubmitButton";
import { buttonClass, buttonSecondaryClass, errorClass, inputClass } from "../ui";
import { loadJobEditOptions, saveJobEdit, type JobEditOptions, type JobEditState } from "./edit-actions";
import { JOB_STATUS_LABEL } from "./JobStatusForm";
import {
  JOB_STATUS_OPTIONS,
  JOB_TYPES,
  JOB_TYPE_LABEL,
  NEW_PROPERTY_VALUE,
  NOTES_MAX,
  normalizeJobStatus,
} from "@/lib/job-edit-rules";
import type { InvoicePrompt } from "@/lib/job-invoice-rules";
import { toEtLocalInput } from "@/lib/tz";

export type EditableJob = {
  id: string;
  customer_id?: string | null;
  property_id?: string | null;
  job_type?: string | null;
  notes: string | null;
  assigned_staff_id?: string | null;
  scheduled_at: string | null;
  status: string;
};

/**
 * Owner/office: edit any part of a job (customer, address, type, notes, tech, time, status).
 * Only what you change is saved, through the same actions as everywhere else.
 */
export default function EditJobForm({
  job,
  staff,
  onInvoicePrompt,
  onDone,
}: {
  job: EditableJob;
  staff: { id: string; name: string }[];
  onInvoicePrompt: (prompt: InvoicePrompt) => void;
  onDone: () => void;
}) {
  const [state, action] = useActionState<JobEditState, FormData>(saveJobEdit, null);
  const [options, setOptions] = useState<JobEditOptions | null>(null);

  const original = {
    customerId: job.customer_id ?? "",
    propertyId: job.property_id ?? "",
    jobType: job.job_type ?? "",
    notes: job.notes ?? "",
    staffId: job.assigned_staff_id ?? "",
    scheduledAt: job.scheduled_at ? toEtLocalInput(job.scheduled_at) : "",
    status: normalizeJobStatus(job.status),
  };
  const [customerId, setCustomerId] = useState(original.customerId);
  const [propertyId, setPropertyId] = useState(original.propertyId);

  useEffect(() => {
    let live = true;
    loadJobEditOptions()
      .then((o) => live && setOptions(o))
      .catch(() => live && setOptions({ error: "Couldn't load customers and addresses.", customers: [], properties: [] }));
    return () => {
      live = false;
    };
  }, []);

  // Handle each result once, even if the parent re-renders with new callbacks.
  const handled = useRef<JobEditState>(null);
  useEffect(() => {
    if (state === handled.current) return;
    handled.current = state;
    if (state?.invoicePrompt) onInvoicePrompt(state.invoicePrompt);
    if (state?.saved) onDone();
  }, [state, onInvoicePrompt, onDone]);

  const customerProperties = useMemo(
    () => (options?.properties ?? []).filter((p) => customerId && p.customer_id === customerId),
    [options, customerId]
  );

  if (!options) return <p className="text-xs text-g300">Loading customers and addresses…</p>;
  if (options.error) return <p className={errorClass}>{options.error}</p>;

  const v = state?.values;
  // A customer or address not in the lists (deleted, or unlinked) still shows, so nothing changes by accident.
  const customerMissing = original.customerId && !options.customers.some((c) => c.id === original.customerId);
  const propertyMissing = original.propertyId && !customerProperties.some((p) => p.id === original.propertyId);

  return (
    <form action={action} className="grid gap-3 rounded-xl border border-white/8 bg-white/3 p-3 sm:grid-cols-2">
      <input type="hidden" name="job_id" value={job.id} />
      <input type="hidden" name="original_customer_id" value={original.customerId} />
      <input type="hidden" name="original_property_id" value={original.propertyId} />
      <input type="hidden" name="original_job_type" value={original.jobType} />
      <input type="hidden" name="original_notes" value={original.notes} />
      <input type="hidden" name="original_staff_id" value={original.staffId} />
      <input type="hidden" name="original_scheduled_at" value={original.scheduledAt} />
      <input type="hidden" name="original_status" value={original.status} />

      <label className="flex flex-col gap-1 text-xs text-g300">
        Customer
        <select
          name="customer_id"
          value={customerId}
          onChange={(e) => {
            setCustomerId(e.target.value);
            setPropertyId("");
          }}
          className={inputClass}
        >
          <option value="">No customer</option>
          {customerMissing && <option value={original.customerId}>(current customer)</option>}
          {options.customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-g300">
        Address
        <select name="property_id" value={propertyId} onChange={(e) => setPropertyId(e.target.value)} className={inputClass}>
          <option value="">No address</option>
          {propertyMissing && customerId === original.customerId && (
            <option value={original.propertyId}>(current address)</option>
          )}
          {customerProperties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.address}
            </option>
          ))}
          {customerId && <option value={NEW_PROPERTY_VALUE}>+ New address</option>}
        </select>
      </label>

      {propertyId === NEW_PROPERTY_VALUE && (
        <label className="flex flex-col gap-1 text-xs text-g300 sm:col-span-2">
          New address (added to this customer)
          <input name="new_address" defaultValue={v?.newAddress ?? ""} placeholder="Street, town" className={inputClass} />
        </label>
      )}

      <label className="flex flex-col gap-1 text-xs text-g300">
        Job type
        <select name="job_type" defaultValue={v?.jobType ?? original.jobType} className={inputClass}>
          {!original.jobType && <option value="">Pick a type</option>}
          {JOB_TYPES.map((t) => (
            <option key={t} value={t}>
              {JOB_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-g300">
        Tech
        <select name="staff_id" defaultValue={v?.staffId ?? original.staffId} className={inputClass}>
          <option value="">Unassigned</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-g300">
        Date and time (New York)
        <input
          type="datetime-local"
          name="scheduled_at"
          defaultValue={v?.scheduledAt ?? original.scheduledAt}
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-g300">
        Status
        <select name="status" defaultValue={v?.status ?? original.status} className={inputClass}>
          {JOB_STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {JOB_STATUS_LABEL[s] ?? s}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-g300 sm:col-span-2">
        Job notes
        <textarea
          name="notes"
          rows={3}
          maxLength={NOTES_MAX}
          defaultValue={v?.notes ?? original.notes}
          className={inputClass}
        />
      </label>

      {state?.needsReason && (
        <label className="flex flex-col gap-1 text-xs text-g300 sm:col-span-2">
          Why mark it done anyway? (saved with your name)
          <input
            name="done_reason"
            defaultValue={v?.doneReason ?? ""}
            placeholder="e.g. Tech's phone died, work checked by me"
            className={inputClass}
          />
        </label>
      )}

      <p className="text-[11px] text-g500 sm:col-span-2">
        Changing the time sends the customer the usual schedule notice (not on a finished or cancelled job). Setting
        Scheduled sends it too. Complete makes the draft invoice and sends your finish alert.
      </p>

      {state?.error && <p className={`${errorClass} sm:col-span-2`}>{state.error}</p>}

      <div className="flex gap-2 sm:col-span-2">
        <SubmitButton className={buttonClass} pendingText="Saving…">
          Save changes
        </SubmitButton>
        <button type="button" onClick={onDone} className={buttonSecondaryClass}>
          Close
        </button>
      </div>
    </form>
  );
}
