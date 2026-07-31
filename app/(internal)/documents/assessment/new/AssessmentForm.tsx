"use client";

import { useMemo, useState } from "react";
import { submitAssessment } from "./actions";
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
type Equipment = { id: string; type: string; brand: string | null; model: string | null; property_id: string | null };

let nextRowId = 1;

export default function AssessmentForm({
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
  const [extracted, setExtracted] = useState<Record<number, ScannedNameplate | null>>({});
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

  async function handleScan(rowId: number, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setScanningRow(rowId);
    setScanError((prev) => ({ ...prev, [rowId]: "" }));
    try {
      const formData = new FormData();
      formData.set("photo", file);
      const result = await scanNameplate(formData);
      setExtracted((prev) => ({ ...prev, [rowId]: result }));
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
    <form action={submitAssessment} className="flex flex-col gap-4">
      <input type="hidden" name="row_count" value={rowIds.length} />

      <div className="grid gap-3 rounded-xl border border-white/8 bg-white/3 p-4 sm:grid-cols-2">
        <CustomerPicker customers={customers} value={customerId} onChange={setCustomerId} />
        <PropertyPicker
          properties={properties}
          customerId={customerId}
          value={propertyId}
          onChange={setPropertyId}
        />
      </div>

      <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Equipment Assessed</h2>

      {rowIds.map((rowId, index) => {
        const rowExtracted = extracted[rowId] ?? null;
        return (
          <section
            key={`${rowId}-${JSON.stringify(rowExtracted)}`}
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
              <select name={`equipment_id_${index}`} className={inputClass} defaultValue="">
                <option value="">New equipment (fill in below, or scan nameplate)</option>
                {propertyEquipment.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.type}
                    {e.brand ? ` — ${e.brand}` : ""}
                    {e.model ? ` ${e.model}` : ""}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex flex-col gap-2 rounded-lg border border-white/8 bg-white/3 p-3">
              <label className="text-xs text-g300">Scan nameplate photo (only needed for new equipment)</label>
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

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs text-g300">
                Type
                <input
                  name={`new_equipment_type_${index}`}
                  placeholder="Type (e.g. mini-split, boiler)"
                  defaultValue={rowExtracted?.type ?? ""}
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-g300">
                Brand
                <input
                  name={`new_equipment_brand_${index}`}
                  placeholder="Brand"
                  defaultValue={rowExtracted?.brand ?? ""}
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-g300">
                Model
                <input
                  name={`new_equipment_model_${index}`}
                  placeholder="Model"
                  defaultValue={rowExtracted?.model ?? ""}
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-g300">
                Refrigerant
                <input
                  name={`new_equipment_refrigerant_${index}`}
                  placeholder="Refrigerant (optional)"
                  defaultValue={rowExtracted?.refrigerant_type ?? ""}
                  className={inputClass}
                />
              </label>
            </div>

            <label className="flex flex-col gap-1 text-xs text-g300">
              Condition
              <select name={`condition_${index}`} className={inputClass} defaultValue="working_well">
                <option value="working_well">Working well</option>
                <option value="working_with_issues">Working, with issues</option>
                <option value="not_working">Not working</option>
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs text-g300">
              Observations
              <textarea
                name={`observations_${index}`}
                rows={3}
                placeholder="What did you observe? Age, noise, pressures/readings if taken, anything notable — Claude will turn this into a written summary and recommendation."
                className={inputClass}
              />
            </label>

            <label className="flex flex-col gap-1 text-xs text-g300">
              Photos (nameplate, condition, anything worth showing the customer)
              <input
                type="file"
                name={`photos_${index}`}
                multiple
                accept="image/*"
                capture="environment"
                className={inputClass}
              />
            </label>
          </section>
        );
      })}

      <button type="button" onClick={addRow} className={`${buttonSecondaryClass} w-fit`}>
        + Add Another Piece of Equipment
      </button>

      {customers.length === 0 && (
        <p className={subTextClass}>Add a customer first before creating an assessment.</p>
      )}

      <SubmitButton className={`${buttonClass} w-fit`} pendingText="Generating…">
        ⚡ Generate Condition Assessment
      </SubmitButton>
    </form>
  );
}
