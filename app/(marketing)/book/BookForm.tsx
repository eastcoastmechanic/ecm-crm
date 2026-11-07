"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { bookService, type BookState } from "./actions";
import SubmitButton from "../../(internal)/SubmitButton";
import { buttonClass, errorClass, inputClass } from "../../(internal)/ui";
import { SpamTrap } from "../SpamTrap";

const SERVICE_TYPES = [
  "Heating repair or installation",
  "Cooling / AC repair or installation",
  "Ductless mini-split",
  "Ductwork",
  "Heat pump",
  "Air quality / filtration",
  "Maintenance / tune-up",
  "Something else",
];

const EMPTY = {
  name: "",
  phone: "",
  email: "",
  address: "",
  service_type: "",
  date: "",
  window: "morning",
  notes: "",
};

export default function BookForm() {
  const [state, action] = useActionState<BookState, FormData>(bookService, null);
  // Controlled, so an error keeps what the customer typed (React resets uncontrolled fields after an action).
  const [v, setV] = useState(EMPTY);
  const [smsConsent, setSmsConsent] = useState(false);
  const set =
    (key: keyof typeof EMPTY) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setV((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <form action={action} className="flex flex-col gap-4 rounded-xl border border-white/8 bg-white/3 p-5">
      <SpamTrap />
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-g300">
          Name
          <input name="name" required value={v.name} onChange={set("name")} className={inputClass} placeholder="Your full name" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-g300">
          Phone
          <input
            name="phone"
            type="tel"
            required
            value={v.phone}
            onChange={set("phone")}
            className={inputClass}
            placeholder="(555) 555-5555"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs text-g300">
        Email (optional)
        <input name="email" type="email" value={v.email} onChange={set("email")} className={inputClass} placeholder="you@example.com" />
      </label>

      <label className="flex flex-col gap-1 text-xs text-g300">
        Service address
        <input name="address" required value={v.address} onChange={set("address")} className={inputClass} placeholder="Street, city" />
      </label>

      <label className="flex flex-col gap-1 text-xs text-g300">
        Service type
        <select name="service_type" required value={v.service_type} onChange={set("service_type")} className={inputClass}>
          <option value="" disabled>
            Select a service
          </option>
          {SERVICE_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-g300">
          Preferred date
          <input name="date" type="date" required value={v.date} onChange={set("date")} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-g300">
          Preferred time
          <select name="window" value={v.window} onChange={set("window")} className={inputClass}>
            <option value="morning">Morning</option>
            <option value="afternoon">Afternoon</option>
            <option value="evening">Evening</option>
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs text-g300">
        Details (optional)
        <textarea
          name="notes"
          rows={3}
          value={v.notes}
          onChange={set("notes")}
          className={inputClass}
          placeholder="Tell us more about what's going on"
        />
      </label>

      <label className="flex items-start gap-2 text-xs text-g300">
        <input
          type="checkbox"
          name="sms_consent"
          checked={smsConsent}
          onChange={(e) => setSmsConsent(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          Text me updates about my appointment. Message and data rates may apply, reply STOP to opt out. See our{" "}
          <Link href="/privacy" className="underline">
            Privacy Policy
          </Link>{" "}
          and{" "}
          <Link href="/terms" className="underline">
            Terms of Service
          </Link>
          .
        </span>
      </label>

      {state?.error && (
        <p role="alert" className={errorClass}>
          {state.error}
        </p>
      )}

      <SubmitButton className={`${buttonClass} w-fit`} pendingText="Submitting…">
        Request Appointment
      </SubmitButton>
    </form>
  );
}
