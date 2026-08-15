"use client";

import { useState } from "react";
import { submitContract } from "./actions";
import SubmitButton from "../../../SubmitButton";
import { buttonClass, inputClass, subTextClass } from "../../../ui";
import CustomerPicker from "../../../CustomerPicker";
import PropertyPicker from "../../../PropertyPicker";

type Customer = { id: string; name: string };
type Property = { id: string; address: string; customer_id: string | null };
type Prefill = {
  customerId: string | null;
  propertyId: string | null;
  price: number | null;
  scopeOfWork: string;
  fromDocumentId: string;
} | null;

export default function ContractForm({
  customers,
  properties,
  prefill,
  defaultPaymentTerms,
  defaultWarrantyTerms,
}: {
  customers: Customer[];
  properties: Property[];
  prefill: Prefill;
  defaultPaymentTerms: string;
  defaultWarrantyTerms: string;
}) {
  const [customerId, setCustomerId] = useState(prefill?.customerId ?? "");
  const [propertyId, setPropertyId] = useState(prefill?.propertyId ?? "");

  return (
    <form action={submitContract} className="flex flex-col gap-4">
      {prefill?.fromDocumentId && (
        <input type="hidden" name="from_document_id" value={prefill.fromDocumentId} />
      )}

      <div className="grid gap-3 rounded-xl border border-white/8 bg-white/3 p-4 sm:grid-cols-2">
        <CustomerPicker customers={customers} value={customerId} onChange={setCustomerId} />
        <PropertyPicker
          properties={properties}
          customerId={customerId}
          value={propertyId}
          onChange={setPropertyId}
        />
      </div>

      <label className="flex flex-col gap-1 text-xs text-g300">
        Contract price
        <input
          type="number"
          name="price"
          min="0.01"
          step="0.01"
          required
          defaultValue={prefill?.price ?? undefined}
          placeholder="e.g. 8500.00"
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-g300">
        Scope of work
        <textarea
          name="scope_of_work"
          required
          rows={6}
          defaultValue={prefill?.scopeOfWork ?? ""}
          placeholder="What work is being performed, what equipment is involved, what's included."
          className={inputClass}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-g300">
          Start date
          <input type="date" name="start_date" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-g300">
          Estimated completion
          <input type="date" name="estimated_completion" className={inputClass} />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs text-g300">
        Payment terms
        <textarea name="payment_terms" rows={3} defaultValue={defaultPaymentTerms} className={inputClass} />
      </label>

      <label className="flex flex-col gap-1 text-xs text-g300">
        Warranty terms
        <textarea name="warranty_terms" rows={3} defaultValue={defaultWarrantyTerms} className={inputClass} />
      </label>

      <label className="flex flex-col gap-1 text-xs text-g300">
        Additional notes (optional)
        <textarea name="notes" rows={2} className={inputClass} />
      </label>

      <p className={subTextClass}>
        The right-to-cancel notice, arbitration notice, and general terms are added automatically —
        no need to type those in.
      </p>

      {customers.length === 0 && (
        <p className={subTextClass}>Add a customer first before creating a contract.</p>
      )}

      <SubmitButton className={`${buttonClass} w-fit`} pendingText="Saving…">
        Save Contract
      </SubmitButton>
    </form>
  );
}
