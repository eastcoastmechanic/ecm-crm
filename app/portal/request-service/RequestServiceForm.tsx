"use client";

import { useActionState, useState } from "react";
import { requestService, type RequestState } from "./actions";
import SubmitButton from "../../(internal)/SubmitButton";
import { buttonClass, errorClass, inputClass } from "../../(internal)/ui";
import { REQUEST_NOTE_MAX } from "@/lib/portal-view";

export default function RequestServiceForm({ properties }: { properties: { id: string; address: string | null }[] }) {
  const [state, action] = useActionState<RequestState, FormData>(requestService, null);
  // Controlled, so an error keeps what was typed (React resets uncontrolled fields after an action).
  const [propertyId, setPropertyId] = useState(properties.length === 1 ? properties[0].id : "");
  const [date, setDate] = useState("");
  const [timeWindow, setTimeWindow] = useState("morning");
  const [notes, setNotes] = useState("");

  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-xs text-g300">
        Property
        <select name="property_id" required className={inputClass} value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
          <option value="" disabled>
            Select property
          </option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.address}
            </option>
          ))}
        </select>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-g300">
          Preferred date
          <input type="date" name="date" required className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-g300">
          Preferred window
          <select name="window" required className={inputClass} value={timeWindow} onChange={(e) => setTimeWindow(e.target.value)}>
            <option value="morning">Morning (8am–12pm)</option>
            <option value="afternoon">Afternoon (12pm–4pm)</option>
            <option value="evening">Evening (4pm–6pm)</option>
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs text-g300">
        What&apos;s going on?
        <textarea
          name="notes"
          required
          rows={4}
          maxLength={REQUEST_NOTE_MAX}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. AC isn't cooling, blowing warm air for the past two days."
          className={inputClass}
        />
      </label>

      {state?.error && (
        <p role="alert" className={errorClass}>
          {state.error}
        </p>
      )}

      <SubmitButton className={`${buttonClass} w-fit`} pendingText="Submitting…">
        Submit Request
      </SubmitButton>
    </form>
  );
}
