"use client";

import { useMemo, useState } from "react";
import { REFRIGERANT_TYPES } from "@/lib/refrigerant";
import { assignCustomer } from "./actions";
import SubmitButton from "../../SubmitButton";
import { buttonClass, buttonSecondaryClass, inputClass } from "../../ui";

type Customer = { id: string; name: string };
type Property = { id: string; address: string; customer_id: string | null };
type Equipment = { id: string; type: string; brand: string | null; model: string | null; property_id: string | null };

export default function AssignCustomerForm({
  diagnosticId,
  customers,
  properties,
  equipment,
}: {
  diagnosticId: string;
  customers: Customer[];
  properties: Property[];
  equipment: Equipment[];
}) {
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [customerId, setCustomerId] = useState("");
  const [propertyId, setPropertyId] = useState("");

  const customerProperties = useMemo(
    () => properties.filter((p) => p.customer_id === customerId),
    [properties, customerId]
  );
  const propertyEquipment = useMemo(
    () => equipment.filter((e) => e.property_id === propertyId),
    [equipment, propertyId]
  );

  return (
    <section className="rounded-xl border border-accent/30 bg-accent/5 p-4">
      <div className="text-xs font-bold uppercase tracking-wide text-accent">
        No customer assigned yet
      </div>
      <p className="mt-1 text-sm text-g300">
        Attach this diagnostic to a customer whenever you have their info.
      </p>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => setMode("existing")}
          className={mode === "existing" ? buttonClass : buttonSecondaryClass}
        >
          Existing Customer
        </button>
        <button
          type="button"
          onClick={() => setMode("new")}
          className={mode === "new" ? buttonClass : buttonSecondaryClass}
        >
          New Customer
        </button>
      </div>

      <form action={assignCustomer} className="mt-4 flex flex-col gap-3">
        <input type="hidden" name="diagnostic_id" value={diagnosticId} />

        {mode === "existing" ? (
          <>
            <label className="flex flex-col gap-1 text-xs text-g300">
              Customer
              <select
                name="customer_id"
                required
                className={inputClass}
                value={customerId}
                onChange={(e) => {
                  setCustomerId(e.target.value);
                  setPropertyId("");
                }}
              >
                <option value="" disabled>
                  Select customer
                </option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs text-g300">
              Property
              <select
                name="property_id"
                className={inputClass}
                value={propertyId}
                onChange={(e) => setPropertyId(e.target.value)}
              >
                <option value="">No property yet (type a new address below)</option>
                {customerProperties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.address}
                  </option>
                ))}
              </select>
            </label>
            {!propertyId && (
              <label className="flex flex-col gap-1 text-xs text-g300">
                New service address
                <input name="address" placeholder="New service address" className={inputClass} />
              </label>
            )}

            <label className="flex flex-col gap-1 text-xs text-g300">
              Equipment
              <select name="equipment_id" className={inputClass} defaultValue="">
                <option value="">No equipment yet (optional, fill in below)</option>
                {propertyEquipment.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.type}
                    {e.brand ? ` — ${e.brand}` : ""}
                    {e.model ? ` ${e.model}` : ""}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs text-g300">
                Customer name
                <input name="customer_name" placeholder="Customer name" required className={inputClass} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-g300">
                Phone
                <input name="phone" placeholder="Phone" className={inputClass} />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-xs text-g300">
              Service address
              <input name="address" placeholder="Service address" required className={inputClass} />
            </label>
            <label className="flex items-start gap-2 text-xs text-g300">
              <input type="checkbox" name="sms_consent" className="mt-0.5" />
              <span>
                Customer has verbally agreed to receive text messages about their appointments (message
                frequency varies, msg &amp; data rates may apply, reply STOP to opt out anytime).
              </span>
            </label>
          </>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-g300">
            Equipment type
            <input name="equipment_type" placeholder="Equipment type (optional)" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-g300">
            Brand
            <input name="equipment_brand" placeholder="Brand (optional)" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-g300">
            Model
            <input name="equipment_model" placeholder="Model (optional)" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-g300">
            Refrigerant
            <select name="equipment_refrigerant" className={inputClass} defaultValue="">
              <option value="">Refrigerant (optional)</option>
              {REFRIGERANT_TYPES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        </div>

        <SubmitButton className={`${buttonClass} w-fit`}>Assign Customer</SubmitButton>
      </form>
    </section>
  );
}
