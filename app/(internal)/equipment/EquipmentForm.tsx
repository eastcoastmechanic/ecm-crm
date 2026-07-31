"use client";

import { useState } from "react";
import { addEquipment, scanNameplate, type ScannedNameplate } from "./actions";
import SubmitButton from "../SubmitButton";
import { buttonClass, buttonSecondaryClass, cardClass, errorClass, inputClass } from "../ui";

type Property = {
  id: string;
  address: string;
  customers: { name: string | null }[] | null;
};

export default function EquipmentForm({ properties }: { properties: Property[] }) {
  const [extracted, setExtracted] = useState<ScannedNameplate | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  async function handleScan(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setScanning(true);
    setScanError(null);
    try {
      const formData = new FormData();
      formData.set("photo", file);
      const result = await scanNameplate(formData);
      setExtracted(result);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Failed to read photo");
    } finally {
      setScanning(false);
    }
  }

  return (
    <form key={JSON.stringify(extracted)} action={addEquipment} className={cardClass}>
      <div className="flex flex-col gap-2 rounded-lg border border-white/8 bg-white/3 p-3 sm:col-span-2">
        <label className="text-xs font-bold uppercase tracking-wide text-g300">
          Scan Nameplate Photo (optional)
        </label>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleScan}
          className={inputClass}
        />
        {scanning && <p className="text-xs text-g300">Reading nameplate…</p>}
        {scanError && <p className={errorClass}>{scanError}</p>}
        {extracted && !scanning && (
          <p className="text-xs text-g300">Fields below pre-filled — review before saving.</p>
        )}
      </div>

      <label className="flex flex-col gap-1 text-xs text-g300">
        Property
        <select name="property_id" required className={inputClass} defaultValue="">
          <option value="" disabled>
            Select property
          </option>
          {properties?.map((property) => (
            <option key={property.id} value={property.id}>
              {property.address}
              {property.customers?.[0]?.name ? ` — ${property.customers[0].name}` : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-g300">
        Type
        <input
          name="type"
          placeholder="Type (e.g. mini-split, boiler)"
          defaultValue={extracted?.type ?? ""}
          required
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-g300">
        Brand
        <input name="brand" placeholder="Brand" defaultValue={extracted?.brand ?? ""} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-g300">
        Model
        <input name="model" placeholder="Model" defaultValue={extracted?.model ?? ""} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-g300">
        Serial number
        <input
          name="serial_number"
          placeholder="Serial number"
          defaultValue={extracted?.serial_number ?? ""}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-g300">
        Refrigerant type
        <input
          name="refrigerant_type"
          placeholder="Refrigerant type"
          defaultValue={extracted?.refrigerant_type ?? ""}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-g300">
        Install date
        <input name="install_date" type="date" className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-g300">
        Warranty expiration
        <input name="warranty_expiration" type="date" className={inputClass} />
      </label>
      <SubmitButton className={`${buttonClass} sm:col-span-2 sm:w-fit`}>Add Equipment</SubmitButton>
      {extracted && (
        <button
          type="button"
          onClick={() => setExtracted(null)}
          className={`${buttonSecondaryClass} sm:w-fit`}
        >
          Clear Scanned Fields
        </button>
      )}
    </form>
  );
}
