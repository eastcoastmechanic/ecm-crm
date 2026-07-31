"use client";

import { inputClass } from "./ui";
import { NEW_CUSTOMER_VALUE } from "./intake-constants";

type Customer = { id: string; name: string };

export default function CustomerPicker({
  customers,
  value,
  onChange,
  required = true,
}: {
  customers: Customer[];
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-xs text-g300">
        Customer
        <select
          name="customer_id"
          required={required}
          className={inputClass}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="" disabled>
            Select customer
          </option>
          <option value={NEW_CUSTOMER_VALUE}>+ Add new customer</option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name}
            </option>
          ))}
        </select>
      </label>

      {value === NEW_CUSTOMER_VALUE && (
        <div className="grid gap-3 rounded-lg border border-white/8 bg-white/3 p-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-g300">
            Customer name
            <input name="new_customer_name" placeholder="Customer name" required className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-g300">
            Phone
            <input name="new_customer_phone" placeholder="Phone" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-g300 sm:col-span-2">
            Email
            <input name="new_customer_email" placeholder="Email (optional)" className={inputClass} />
          </label>
          <label className="flex items-start gap-2 text-xs text-g300 sm:col-span-2">
            <input type="checkbox" name="new_customer_sms_consent" className="mt-0.5" />
            <span>
              Customer has verbally agreed to receive text messages (message frequency varies,
              msg &amp; data rates may apply, reply STOP to opt out anytime).
            </span>
          </label>
        </div>
      )}
    </div>
  );
}
