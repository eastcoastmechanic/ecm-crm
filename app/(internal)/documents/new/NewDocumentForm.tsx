"use client";

import { useState } from "react";
import { generateDocument } from "./actions";
import SubmitButton from "../../SubmitButton";
import { buttonClass, inputClass, subTextClass } from "../../ui";
import CustomerPicker from "../../CustomerPicker";

type Customer = { id: string; name: string };
type Property = {
  id: string;
  address: string;
  customer_id: string | null;
  customers: { name: string | null }[] | null;
};

export default function NewDocumentForm({
  customers,
  properties,
}: {
  customers: Customer[];
  properties: Property[];
}) {
  const [customerId, setCustomerId] = useState("");

  return (
    <form action={generateDocument} className="flex flex-col gap-4">
      <div className="grid gap-3 rounded-xl border border-white/8 bg-white/3 p-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-g300">
          Document type
          <select name="type" required className={inputClass} defaultValue="estimate">
            <option value="estimate">Estimate</option>
            <option value="invoice">Invoice</option>
            <option value="proposal">Proposal</option>
          </select>
        </label>
        <CustomerPicker customers={customers} value={customerId} onChange={setCustomerId} />
        <label className="flex flex-col gap-1 text-xs text-g300 sm:col-span-2">
          Property
          <select name="property_id" className={inputClass} defaultValue="">
            <option value="">No property (general estimate)</option>
            {properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.address}
                {property.customers?.[0]?.name ? ` — ${property.customers[0].name}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-g300 sm:col-span-2">
          Job description
          <textarea
            name="raw_request"
            required
            placeholder="Describe the job in plain language — e.g. 'Replace 2-zone ductless system in the main house, customer wants heat pump water heater too, mention MassSave rebates.'"
            className={`${inputClass} min-h-32`}
          />
        </label>
      </div>

      {customers.length === 0 && (
        <p className={subTextClass}>Add a customer first before generating a document.</p>
      )}

      <SubmitButton className={`${buttonClass} w-fit`} pendingText="Generating…">
        ⚡ Generate Document
      </SubmitButton>
    </form>
  );
}
