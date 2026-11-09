"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { REFRIGERANT_TYPES } from "@/lib/refrigerant";
import { generateDiagnosis, scanReadingPhoto, type ScannedReadings } from "./actions";
import { downscaleFileInput, downscaleImage, totalBytes } from "@/lib/downscale-image";
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
  isTech = false,
}: {
  equipment: Equipment[];
  jobId?: string;
  /** A tech's report goes on the job's customer: no new customer, consent or unit fields. */
  isTech?: boolean;
}) {
  const [extracted, setExtracted] = useState<ScannedReadings | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [equipmentId, setEquipmentId] = useState("");
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const router = useRouter();

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
      if (result.error !== undefined) {
        setScanError(result.error);
      } else {
        // Only values the photo actually showed change; a second scan (say the
        // meter after the gauges) adds to the first instead of blanking it.
        const scanned = result.readings;
        setExtracted((prev) => {
          const merged = { ...(prev ?? scanned) } as ScannedReadings;
          for (const key of Object.keys(scanned) as (keyof ScannedReadings)[]) {
            if (scanned[key] !== null) merged[key] = scanned[key];
          }
          return merged;
        });
      }
    } catch {
      setScanError("Couldn't read that photo. Type the readings in, or try another photo.");
    } finally {
      setScanning(false);
    }
  }

  // Submits by hand, not as a form action: React clears a form's fields after an
  // action runs, even a failed one, and the tech would lose the symptoms,
  // readings and photos. On an error everything stays as entered.
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    const data = new FormData(e.currentTarget);
    setSubmitError(null);
    setSubmitting(true);
    try {
      const result = await generateDiagnosis(data);
      if (result.error !== undefined) {
        setSubmitError(result.error);
        setSubmitting(false);
        return;
      }
      // Stays "Generating…" while the report page opens.
      router.push(`/diagnostics/${result.id}`);
    } catch {
      setSubmitError("Couldn't get a diagnosis. Your entries are kept, try again.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
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
            <option value="">
              {isTech
                ? "No equipment on file yet (leave blank)"
                : "No equipment on file yet (fill in details below, or leave blank)"}
            </option>
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

      {isTech && (
        <p className="text-xs text-g300">
          This report goes on the job&apos;s customer and address. New customer details or a new unit: ask the
          office to add them.
        </p>
      )}

      {!isTech && !equipmentId && (
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

      {submitError && (
        <p role="alert" className={errorClass}>
          {submitError}
        </p>
      )}
      <button type="submit" disabled={submitting} className={`${buttonClass} w-fit disabled:opacity-50`}>
        {submitting ? "Generating…" : "Generate Diagnosis"}
      </button>
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
        // A new scanned value remounts just this field with it; anything typed
        // in the other fields (and the symptoms and photos) stays put.
        key={value ?? "none"}
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
