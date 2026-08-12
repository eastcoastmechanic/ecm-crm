"use client";

import { useState } from "react";
import { REFRIGERANT_TYPES } from "@/lib/refrigerant";
import { generateDiagnosis, scanReadingPhoto, type ScannedReadings } from "./actions";
import { downscaleFileInput, downscaleImage, totalBytes } from "@/lib/downscale-image";
import SubmitButton from "../../SubmitButton";
import { buttonClass, errorClass, inputClass } from "../../ui";

type Equipment = {
  id: string;
  type: string;
  brand: string | null;
  model: string | null;
  refrigerant_type: string | null;
  properties: { address: string | null; customers: { name: string | null }[] | null }[] | null;
};

export default function DiagnosticForm({
  equipment,
  jobId,
}: {
  equipment: Equipment[];
  jobId?: string;
}) {
  const [extracted, setExtracted] = useState<ScannedReadings | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [equipmentId, setEquipmentId] = useState("");
  const [photoNote, setPhotoNote] = useState<string | null>(null);

  async function handleScan(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setScanning(true);
    setScanError(null);
    try {
      const formData = new FormData();
      // Same 4.5MB platform cap as the photo upload below — a full-resolution
      // gauge photo alone can exceed it.
      formData.set("photo", await downscaleImage(file));
      const result = await scanReadingPhoto(formData);
      setExtracted(result);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Failed to read photo");
    } finally {
      setScanning(false);
    }
  }

  return (
    <form
      key={JSON.stringify(extracted)}
      action={generateDiagnosis}
      className="flex flex-col gap-6"
    >
      {jobId && <input type="hidden" name="job_id" value={jobId} />}

      <section className="flex flex-col gap-3 rounded-xl border border-white/8 p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Equipment</h2>
        <label className="flex flex-col gap-1 text-xs text-g300">
          Equipment
          <select
            name="equipment_id"
            className={inputClass}
            value={equipmentId}
            onChange={(e) => setEquipmentId(e.target.value)}
          >
            <option value="">No equipment on file yet (fill in details below, or leave blank)</option>
            {equipment?.map((item) => (
              <option key={item.id} value={item.id}>
                {item.type}
                {item.brand ? ` — ${item.brand}` : ""}
                {item.model ? ` ${item.model}` : ""}
                {item.properties?.[0]?.customers?.[0]?.name
                  ? ` (${item.properties[0].customers[0].name})`
                  : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-g300">
          Refrigerant (overrides equipment record if set)
          <select name="refrigerant" className={inputClass} defaultValue="">
            <option value="">Use equipment record</option>
            {REFRIGERANT_TYPES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
      </section>

      {!equipmentId && (
        <section className="flex flex-col gap-3 rounded-xl border border-white/8 bg-white/3 p-4">
          <h2 className="text-xs font-bold uppercase tracking-wide text-g300">
            Customer Info (optional — can fill in later instead)
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-g300">
              Customer name
              <input name="customer_name" placeholder="Customer name" className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-g300">
              Phone
              <input name="customer_phone" placeholder="Phone" className={inputClass} />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs text-g300">
            Service address
            <input name="customer_address" placeholder="Service address" className={inputClass} />
          </label>
          <label className="flex items-start gap-2 text-xs text-g300">
            <input type="checkbox" name="sms_consent" className="mt-0.5" />
            <span>
              Customer has verbally agreed to receive text messages about their appointments (message
              frequency varies, msg &amp; data rates may apply, reply STOP to opt out anytime).
            </span>
          </label>

          <h3 className="mt-2 text-xs font-bold uppercase tracking-wide text-g300">
            New Equipment (optional)
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-g300">
              Type
              <input
                name="new_equipment_type"
                placeholder="Type (e.g. mini-split, boiler)"
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-g300">
              Brand
              <input name="new_equipment_brand" placeholder="Brand" className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-g300">
              Model
              <input name="new_equipment_model" placeholder="Model" className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-g300">
              Refrigerant
              <select name="new_equipment_refrigerant" className={inputClass} defaultValue="">
                <option value="">Refrigerant (optional)</option>
                {REFRIGERANT_TYPES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-2 rounded-xl border border-white/8 bg-white/3 p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">
          Scan Tool/Gauge Photo (optional)
        </h2>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleScan}
          className={inputClass}
        />
        {scanning && <p className="text-xs text-g300">Reading readings from photo…</p>}
        {scanError && <p className={errorClass}>{scanError}</p>}
        {extracted && !scanning && (
          <p className="text-xs text-g300">Readings below pre-filled — review before generating.</p>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-white/8 p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Operating Conditions</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="outdoor_temp" label="Outdoor Temp (°F)" placeholder="e.g. 85" value={extracted?.outdoor_temp} />
          <Field name="indoor_temp" label="Indoor Temp (°F)" placeholder="e.g. 78" value={extracted?.indoor_temp} />
          <Field
            name="supply_air_temp"
            label="Supply Air Temp (°F)"
            placeholder="e.g. 58"
            value={extracted?.supply_air_temp}
          />
          <Field
            name="return_air_temp"
            label="Return Air Temp (°F)"
            placeholder="e.g. 75"
            value={extracted?.return_air_temp}
          />
          <Field name="indoor_rh" label="Indoor RH %" placeholder="e.g. 52" value={extracted?.indoor_rh} />
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-white/8 p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">
          Pressure Readings &amp; Refrigerant Analysis
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            name="suction_pressure"
            label="Suction Pressure (PSIG)"
            placeholder="e.g. 120"
            value={extracted?.suction_pressure}
          />
          <Field
            name="liquid_pressure"
            label="Liquid Pressure (PSIG)"
            placeholder="e.g. 265"
            value={extracted?.liquid_pressure}
          />
          <Field
            name="suction_line_temp"
            label="Suction Line Temp (°F)"
            placeholder="e.g. 52"
            value={extracted?.suction_line_temp}
          />
          <Field
            name="liquid_line_temp"
            label="Liquid Line Temp (°F)"
            placeholder="e.g. 90"
            value={extracted?.liquid_line_temp}
          />
          <Field
            name="discharge_pressure"
            label="Discharge Pressure (PSIG)"
            placeholder="e.g. 285"
            value={extracted?.discharge_pressure}
          />
          <Field
            name="discharge_temp"
            label="Discharge Temp (°F)"
            placeholder="e.g. 180"
            value={extracted?.discharge_temp}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-white/8 p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Electrical</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            name="amp_draw"
            label="Compressor Amp Draw (A)"
            placeholder="e.g. 14.2"
            value={extracted?.amp_draw}
          />
          <Field name="voltage" label="Line Voltage (V)" placeholder="e.g. 240" value={extracted?.voltage} />
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-white/8 p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Symptoms</h2>
        <textarea
          name="symptoms"
          required
          rows={4}
          aria-label="Symptoms"
          placeholder="What's the customer reporting? What did you observe on site? e.g. 'Not cooling, warm air from vents, unit ices up after running 20 min.'"
          className={inputClass}
        />
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-white/8 p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Photos</h2>
        <input
          type="file"
          name="photos"
          multiple
          accept="image/*"
          capture="environment"
          aria-label="Photos"
          className={inputClass}
          onChange={async (e) => {
            // Shrink before submit, not after. Vercel truncates request
            // bodies over 4.5MB and the multipart parser then fails with
            // "Unexpected end of form" — which reads like a broken form
            // rather than an oversized photo.
            const input = e.currentTarget;
            setPhotoNote("Preparing photos…");
            await downscaleFileInput(input);
            const count = input.files?.length ?? 0;
            const mb = totalBytes(input) / (1024 * 1024);
            setPhotoNote(
              count === 0
                ? null
                : `${count} photo${count === 1 ? "" : "s"} ready (${mb.toFixed(1)} MB)${
                    mb > 4 ? " — still large, consider fewer photos" : ""
                  }`
            );
          }}
        />
        {photoNote && <p className="text-xs text-g300">{photoNote}</p>}
      </section>

      <SubmitButton className={`${buttonClass} w-fit`} pendingText="Generating…">
        Generate Diagnosis
      </SubmitButton>
    </form>
  );
}

function Field({
  name,
  label,
  placeholder,
  value,
}: {
  name: string;
  label: string;
  placeholder: string;
  value?: number | null;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-g300">
      {label}
      <input
        type="number"
        step="any"
        name={name}
        placeholder={placeholder}
        defaultValue={value ?? undefined}
        className={inputClass}
      />
    </label>
  );
}
