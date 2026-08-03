"use client";

import { useMemo, useState } from "react";
import { submitWarranty } from "./actions";
import { scanNameplate, type ScannedNameplate } from "../../../equipment/actions";
import SubmitButton from "../../../SubmitButton";
import { buttonClass, buttonSecondaryClass, errorClass, inputClass, subTextClass } from "../../../ui";
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

let nextRowId = 1;

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
  const [rowIds, setRowIds] = useState<number[]>(() => [nextRowId++]);
  const [equipmentIdByRow, setEquipmentIdByRow] = useState<Record<number, string>>({});
  const [modelByRow, setModelByRow] = useState<Record<number, string>>({});
  const [serialByRow, setSerialByRow] = useState<Record<number, string>>({});
  const [installDateByRow, setInstallDateByRow] = useState<Record<number, string>>({});
  const [registeredByRow, setRegisteredByRow] = useState<Record<number, boolean>>({});
  const [scanned, setScanned] = useState<Record<number, ScannedNameplate | null>>({});
  const [scanningRow, setScanningRow] = useState<number | null>(null);
  const [scanError, setScanError] = useState<Record<number, string>>({});

  const propertyEquipment = useMemo(
    () => equipment.filter((e) => e.property_id === propertyId),
    [equipment, propertyId]
  );

  function addRow() {
    setRowIds((ids) => [...ids, nextRowId++]);
  }

  function removeRow(rowId: number) {
    setRowIds((ids) => ids.filter((id) => id !== rowId));
  }

  function handleEquipmentChange(rowId: number, id: string) {
    setEquipmentIdByRow((prev) => ({ ...prev, [rowId]: id }));
    const selected = propertyEquipment.find((e) => e.id === id);
    if (selected) {
      setModelByRow((prev) => ({ ...prev, [rowId]: selected.model ?? "" }));
      setSerialByRow((prev) => ({ ...prev, [rowId]: selected.serial_number ?? "" }));
      setInstallDateByRow((prev) => ({ ...prev, [rowId]: selected.install_date ?? "" }));
    }
  }

  async function handleScan(rowId: number, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setScanningRow(rowId);
    setScanError((prev) => ({ ...prev, [rowId]: "" }));
    try {
      const formData = new FormData();
      formData.set("photo", file);
      const result = await scanNameplate(formData);
      setScanned((prev) => ({ ...prev, [rowId]: result }));
      if (result.model) setModelByRow((prev) => ({ ...prev, [rowId]: result.model! }));
      if (result.serial_number)
        setSerialByRow((prev) => ({ ...prev, [rowId]: result.serial_number! }));
    } catch (err) {
      setScanError((prev) => ({
        ...prev,
        [rowId]: err instanceof Error ? err.message : "Failed to read photo",
      }));
    } finally {
      setScanningRow(null);
    }
  }

  return (
    <form action={submitWarranty} className="flex flex-col gap-4">
      <input type="hidden" name="row_count" value={rowIds.length} />

      <div className="grid gap-3 rounded-xl border border-white/8 bg-white/3 p-4 sm:grid-cols-2">
        <CustomerPicker customers={customers} value={customerId} onChange={setCustomerId} />
        <PropertyPicker
          properties={properties}
          customerId={customerId}
          value={propertyId}
          onChange={setPropertyId}
        />
        <label className="flex flex-col gap-1 text-xs text-g300 sm:col-span-2">
          Installed by
          <input
            name="technician_name"
            defaultValue="Joshua Crowley"
            placeholder="Technician name"
            className={inputClass}
          />
        </label>
      </div>

      <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Equipment</h2>

      {rowIds.map((rowId, index) => {
        const rowScanned = scanned[rowId] ?? null;
        const equipmentId = equipmentIdByRow[rowId] ?? "";
        const registered = registeredByRow[rowId] ?? false;

        return (
          <section
            key={rowId}
            className="flex flex-col gap-3 rounded-xl border border-white/8 p-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wide text-g300">
                Equipment {index + 1}
              </h3>
              {rowIds.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRow(rowId)}
                  className="text-xs text-g300 underline"
                >
                  Remove
                </button>
              )}
            </div>

            <label className="flex flex-col gap-1 text-xs text-g300">
              Equipment
              <select
                className={inputClass}
                value={equipmentId}
                onChange={(e) => handleEquipmentChange(rowId, e.target.value)}
              >
                <option value="">New equipment (fill in below, or scan nameplate)</option>
                {propertyEquipment.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.type}
                    {e.brand ? ` — ${e.brand}` : ""}
                    {e.model ? ` ${e.model}` : ""}
                  </option>
                ))}
              </select>
              <input type="hidden" name={`equipment_id_${index}`} value={equipmentId} />
            </label>

            <div className="flex flex-col gap-2 rounded-lg border border-white/8 bg-white/3 p-3">
              <label className="text-xs text-g300">Scan nameplate photo — auto-fills model &amp; serial</label>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => handleScan(rowId, e)}
                className={inputClass}
              />
              {scanningRow === rowId && <p className="text-xs text-g300">Reading nameplate…</p>}
              {scanError[rowId] && <p className={errorClass}>{scanError[rowId]}</p>}
            </div>

            {!equipmentId && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs text-g300">
                  Type
                  <input
                    name={`new_equipment_type_${index}`}
                    placeholder="e.g. mini-split, boiler"
                    defaultValue={rowScanned?.type ?? ""}
                    className={inputClass}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-g300">
                  Brand
                  <input
                    name={`new_equipment_brand_${index}`}
                    placeholder="Brand"
                    defaultValue={rowScanned?.brand ?? ""}
                    className={inputClass}
                  />
                </label>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs text-g300">
                Model
                <input
                  name={`model_${index}`}
                  value={modelByRow[rowId] ?? ""}
                  onChange={(e) => setModelByRow((prev) => ({ ...prev, [rowId]: e.target.value }))}
                  placeholder="Model number"
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-g300">
                Serial number
                <input
                  name={`serial_number_${index}`}
                  value={serialByRow[rowId] ?? ""}
                  onChange={(e) => setSerialByRow((prev) => ({ ...prev, [rowId]: e.target.value }))}
                  placeholder="Serial number"
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-g300">
                Date of install
                <input
                  type="date"
                  name={`install_date_${index}`}
                  value={installDateByRow[rowId] ?? ""}
                  onChange={(e) =>
                    setInstallDateByRow((prev) => ({ ...prev, [rowId]: e.target.value }))
                  }
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-g300">
                Warranty docket number
                <input
                  name={`docket_number_${index}`}
                  placeholder="Docket / warranty number"
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-g300">
                Manufacturer warranty length (years)
                <input
                  type="number"
                  name={`manufacturer_years_${index}`}
                  min="0"
                  step="1"
                  placeholder="e.g. 10"
                  className={inputClass}
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-g300">
                <input
                  type="checkbox"
                  name={`registered_${index}`}
                  checked={registered}
                  onChange={(e) =>
                    setRegisteredByRow((prev) => ({ ...prev, [rowId]: e.target.checked }))
                  }
                />
                Registered with manufacturer
              </label>
              {registered && (
                <label className="flex flex-col gap-1 text-xs text-g300">
                  Date of registry
                  <input type="date" name={`registration_date_${index}`} className={inputClass} />
                </label>
              )}
            </div>
          </section>
        );
      })}

      <button type="button" onClick={addRow} className={`${buttonSecondaryClass} w-fit`}>
        + Add Another Piece of Equipment
      </button>

      <div className="rounded-xl border border-accent/30 bg-accent/5 p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-accent">Craftsmanship Warranty</h2>
        <p className={`mt-1 ${subTextClass}`}>
          Every install includes East Coast Mechanical&apos;s standard 1-year craftsmanship warranty on
          labor, starting from each item&apos;s install date above.
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
