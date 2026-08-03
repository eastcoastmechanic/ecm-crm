"use client";

import { useState } from "react";
import { updateCustomer } from "../actions";
import SubmitButton from "../../SubmitButton";
import { buttonClass, buttonSecondaryClass, inputClass, subTextClass } from "../../ui";

type Customer = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  billing_address: string | null;
  notes: string | null;
  sms_consent: boolean | null;
};

export default function EditCustomerForm({ customer }: { customer: Customer }) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={`${buttonSecondaryClass} mt-2 w-fit`}
      >
        Edit
      </button>
    );
  }

  return (
    <form
      action={async (formData) => {
        await updateCustomer(formData);
        setEditing(false);
      }}
      className="mt-3 grid gap-3 rounded-xl border border-white/8 bg-white/3 p-4 sm:grid-cols-2"
    >
      <input type="hidden" name="id" value={customer.id} />
      <label className="flex flex-col gap-1 text-xs text-g300">
        Name
        <input name="name" required defaultValue={customer.name} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-g300">
        Phone
        <input name="phone" defaultValue={customer.phone ?? ""} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-g300">
        Email
        <input name="email" defaultValue={customer.email ?? ""} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-g300">
        Billing address
        <input
          name="billing_address"
          defaultValue={customer.billing_address ?? ""}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-g300 sm:col-span-2">
        Notes
        <textarea name="notes" defaultValue={customer.notes ?? ""} className={inputClass} />
      </label>
      <label className="flex items-center gap-2 text-xs text-g300 sm:col-span-2">
        <input type="checkbox" name="sms_consent" defaultChecked={!!customer.sms_consent} />
        Customer has agreed to receive text messages
      </label>
      <div className="flex items-center gap-2 sm:col-span-2">
        <SubmitButton className={`${buttonClass} w-fit`} pendingText="Saving…">
          Save
        </SubmitButton>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className={`${subTextClass} underline`}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
