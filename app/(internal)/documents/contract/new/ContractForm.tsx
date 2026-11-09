"use client";

import { startTransition, useActionState, useState } from "react";
import { submitContract, type ContractFormState } from "./actions";
import { buttonClass, errorClass, inputClass, subTextClass } from "../../../ui";
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
  defaultCustomerId = "",
  defaultPaymentTerms,
  defaultWarrantyTerms,
}: {
  customers: Customer[];
  properties: Property[];
  prefill: Prefill;
  defaultCustomerId?: string;
  defaultPaymentTerms: string;
  defaultWarrantyTerms: string;
}) {
  const [customerId, setCustomerId] = useState(prefill?.customerId ?? defaultCustomerId);
  const [propertyId, setPropertyId] = useState(prefill?.propertyId ?? "");
  const [state, save, saving] = useActionState<ContractFormState, FormData>(submitContract, null);

  // A new customer/property saved before a later step failed: point the pickers at
  // them so pressing Save again does not create a second copy.
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    if (state?.customerId) setCustomerId(state.customerId);
    if (state?.propertyId) setPropertyId(state.propertyId);
  }

  return (
    // Submitted by hand (not the action prop) so React does not clear what was typed when a save fails.
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => save(data));
      }}
      className="flex flex-col gap-4"
    >
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
        Yearly renewal price, $ (optional — maintenance plans only)
        <input type="number" name="auto_renew_price" min="0" step="0.01" className={inputClass} />
        <span className="text-g300">
          Leave blank unless this contract is a maintenance plan. If filled in, the customer can tick a box when
          signing to allow automatic yearly renewal at this price.
        </span>
      </label>

      <label className="flex flex-col gap-1 text-xs text-g300">
        Plan visit months (maintenance plans only)
        <input type="text" name="visit_months" defaultValue="4, 10" placeholder="4, 10" className={inputClass} />
        <span className="text-g300">
          Month numbers a visit is due. 4, 10 is the AC tune-up in April and heating tune-up in October. Clear it for a
          plan with no scheduled visits.
        </span>
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

      {state?.error && !saving && (
        <p role="alert" className={errorClass}>
          {state.error}
        </p>
      )}
      <button type="submit" disabled={saving} className={`${buttonClass} w-fit disabled:opacity-50`}>
        {saving ? "Saving…" : "Save Contract"}
      </button>
    </form>
  );
}
