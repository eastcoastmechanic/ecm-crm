"use client";

import { useMemo, useState } from "react";
import { submitWarranty } from "./actions";
import SubmitButton from "../../../SubmitButton";
import { buttonClass, inputClass, subTextClass } from "../../../ui";
import CustomerPicker from "../../../CustomerPicker";
import PropertyPicker from "../../../PropertyPicker";

type Customer = { id: string; name: string };
type Property = {
  id: string;
  address: string;
  customer_id: string | null;
  customers: { name: string | null }[] | null;
};
type Equipment = {
  id: string;
  type: string;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  install_date: string | null;
  property_id: string | null;
};

export default function WarrantyForm({
  customers,
  properties,
  equipment,
}: {
  customers: Customer[];
  properties: Property[];
  equipment: Equipment[];
}) {
  const [customerId, setCustomerId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [equipmentId, setEquipmentId] = useState("");
  const [model, setModel] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [installDate, setInstallDate] = useState("");
  const [registered, setRegistered] = useState(false);

  const propertyEquipment = useMemo(
    () => equipment.filter((e) => e.property_id === propertyId),
    [equipment, propertyId]
  );

  function handleEquipmentChange(id: string) {
    setEquipmentId(id);
    const selected = propertyEquipment.find((e) => e.id === id);
    if (selected) {
      setModel(selected.model ?? "");
      setSerialNumber(selected.serial_number ?? "");
      setInstallDate(selected.install_date ?? "");
    }
  }

  return (
    <form action={submitWarranty} className="flex flex-col gap-4">
      <div className="grid gap-3 rounded-xl border border-white/8 bg-white/3 p-4 sm:grid-cols-2">
        <CustomerPicker customers={customers} value={customerId} onChange={setCustomerId} />
        <PropertyPicker
          properties={properties}
          customerId={customerId}
          value={propertyId}
          onChange={setPropertyId}
        />
      </div>

      <div className="grid gap-3 rounded-xl border border-white/8 bg-white/3 p-4 sm:grid-cols-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300 sm:col-span-2">Equipment</h2>
        <label className="flex flex-col gap-1 text-xs text-g300 sm:col-span-2">
          Equipment
          <select
            className={inputClass}
            value={equipmentId}
            onChange={(e) => handleEquipmentChange(e.target.value)}
          >
            <option value="">New equipment (fill in below)</option>
            {propertyEquipment.map((e) => (
              <option key={e.id} value={e.id}>
                {e.type}
                {e.brand ? ` — ${e.brand}` : ""}
                {e.model ? ` ${e.model}` : ""}
              </option>
            ))}
          </select>
          <input type="hidden" name="equipment_id" value={equipmentId} />
        </label>

        {!equipmentId && (
          <>
            <label className="flex flex-col gap-1 text-xs text-g300">
              Type
              <input
                name="new_equipment_type"
                placeholder="e.g. mini-split, boiler"
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-g300">
              Brand
              <input name="new_equipment_brand" placeholder="Brand" className={inputClass} />
            </label>
          </>
        )}

        <label className="flex flex-col gap-1 text-xs text-g300">
          Model
          <input
            name="model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="Model number"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-g300">
          Serial number
          <input
            name="serial_number"
            value={serialNumber}
            onChange={(e) => setSerialNumber(e.target.value)}
            placeholder="Serial number"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-g300">
          Date of install
          <input
            type="date"
            name="install_date"
            value={installDate}
            onChange={(e) => setInstallDate(e.target.value)}
            className={inputClass}
          />
        </label>
      </div>

      <div className="grid gap-3 rounded-xl border border-white/8 bg-white/3 p-4 sm:grid-cols-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300 sm:col-span-2">
          Manufacturer Warranty
        </h2>
        <label className="flex flex-col gap-1 text-xs text-g300">
          Warranty docket number
          <input name="docket_number" placeholder="Docket / warranty number" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-g300">
          Warranty length (years)
          <input
            type="number"
            name="manufacturer_years"
            min="0"
            step="1"
            placeholder="e.g. 10"
            className={inputClass}
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-g300">
          <input
            type="checkbox"
            name="registered"
            checked={registered}
            onChange={(e) => setRegistered(e.target.checked)}
          />
          Registered with manufacturer
        </label>
        {registered && (
          <label className="flex flex-col gap-1 text-xs text-g300">
            Date of registry
            <input type="date" name="registration_date" className={inputClass} />
          </label>
        )}
      </div>

      <div className="rounded-xl border border-accent/30 bg-accent/5 p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-accent">Craftsmanship Warranty</h2>
        <p className={`mt-1 ${subTextClass}`}>
          Every install includes East Coast Mechanical&apos;s standard 1-year craftsmanship warranty on
          labor, starting from the date of install above.
        </p>
      </div>

      {customers.length === 0 && (
        <p className={subTextClass}>Add a customer first before creating a warranty document.</p>
      )}

      <SubmitButton className={`${buttonClass} w-fit`} pendingText="Saving…">
        Save Warranty
      </SubmitButton>
    </form>
  );
}
