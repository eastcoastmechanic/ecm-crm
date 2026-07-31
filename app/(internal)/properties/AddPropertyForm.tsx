"use client";

import { useState } from "react";
import { addProperty } from "./actions";
import SubmitButton from "../SubmitButton";
import { buttonClass, cardClass, inputClass } from "../ui";
import CustomerPicker from "../CustomerPicker";

type Customer = { id: string; name: string };

export default function AddPropertyForm({ customers }: { customers: Customer[] }) {
  const [customerId, setCustomerId] = useState("");

  return (
    <form action={addProperty} className={cardClass}>
      <CustomerPicker customers={customers} value={customerId} onChange={setCustomerId} />
      <label className="flex flex-col gap-1 text-xs text-g300">
        Property type
        <select name="property_type" className={inputClass} defaultValue="">
          <option value="">Property type</option>
          <option value="residential">Residential</option>
          <option value="commercial">Commercial</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-g300 sm:col-span-2">
        Address
        <input name="address" placeholder="Address" required className={inputClass} />
      </label>
      <SubmitButton className={`${buttonClass} sm:col-span-2 sm:w-fit`}>Add Property</SubmitButton>
    </form>
  );
}
