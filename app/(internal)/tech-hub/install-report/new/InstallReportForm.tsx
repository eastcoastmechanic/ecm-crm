"use client";

import { useMemo, useState } from "react";
import { REFRIGERANT_TYPES } from "@/lib/refrigerant";
import { createInstallReport } from "../actions";
import { STARTUP_CHECKLIST_ITEMS } from "../constants";
import SubmitButton from "../../../SubmitButton";
import { buttonClass, inputClass } from "../../../ui";

type Equipment = {
  id: string;
  type: string | null;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  refrigerant_type: string | null;
  properties: { address: string | null; customers: { name: string | null }[] | null }[] | null;
};

function minutesBetween(startStr: string, endStr: string): number | null {
  if (!startStr || !endStr) return null;
  const start = new Date(startStr).getTime();
  const end = new Date(endStr).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return Math.round(((end - start) / 60000) * 10) / 10;
}

export default function InstallReportForm({
  equipment,
  jobId,
}: {
  equipment: Equipment[];
  jobId?: string;
}) {
  const [equipmentId, setEquipmentId] = useState("");
  const selectedEquipment = useMemo(
    () => equipment.find((e) => e.id === equipmentId) ?? null,
    [equipment, equipmentId]
  );

  // Lineset charge calculator inputs
  const [linesetTotalFt, setLinesetTotalFt] = useState("");
  const [chargeRate, setChargeRate] = useState("");
  const [factoryCharge, setFactoryCharge] = useState("");
  const [actualCharge, setActualCharge] = useState("");

  const additionalChargeOz = useMemo(() => {
    const ft = Number(linesetTotalFt);
    const rate = Number(chargeRate);
    if (!ft || !rate) return null;
    return Math.round(ft * rate * 100) / 100;
  }, [linesetTotalFt, chargeRate]);

  const suggestedTotalOz = useMemo(() => {
    if (additionalChargeOz === null) return null;
    const factory = Number(factoryCharge) || 0;
    return Math.round((factory + additionalChargeOz) * 100) / 100;
  }, [additionalChargeOz, factoryCharge]);

  // Nitrogen pressure test
  const [pStartAt, setPStartAt] = useState("");
  const [pEndAt, setPEndAt] = useState("");
  const [pStartPsig, setPStartPsig] = useState("");
  const [pEndPsig, setPEndPsig] = useState("");

  const pressureDurationMin = useMemo(() => minutesBetween(pStartAt, pEndAt), [pStartAt, pEndAt]);
  const pressureDrop = useMemo(() => {
    if (!pStartPsig || !pEndPsig) return null;
    return Math.round((Number(pStartPsig) - Number(pEndPsig)) * 100) / 100;
  }, [pStartPsig, pEndPsig]);

  // Vacuum & decay
  const [decayStart, setDecayStart] = useState("");
  const [decayEnd, setDecayEnd] = useState("");
  const decayRise = useMemo(() => {
    if (!decayStart || !decayEnd) return null;
    return Math.round(Number(decayEnd) - Number(decayStart));
  }, [decayStart, decayEnd]);

  return (
    <form action={createInstallReport} className="flex flex-col gap-6">
      {jobId && <input type="hidden" name="job_id" value={jobId} />}

      <section className="flex flex-col gap-3 rounded-xl border border-white/8 p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Equipment</h2>
        <label className="flex flex-col gap-1 text-xs text-g300">
          Equipment on file (optional)
          <select
            name="equipment_id"
            className={inputClass}
            value={equipmentId}
            onChange={(e) => setEquipmentId(e.target.value)}
          >
            <option value="">Not on file yet — fill in details below</option>
            {equipment.map((item) => (
              <option key={item.id} value={item.id}>
                {item.type}
                {item.brand ? ` — ${item.brand}` : ""}
                {item.model ? ` ${item.model}` : ""}
                {item.properties?.[0]?.customers?.[0]?.name ? ` (${item.properties[0].customers[0].name})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-g300">
          Tech name
          <input name="tech_name" placeholder="Tech name" className={inputClass} />
        </label>
      </section>

      <section
        key={equipmentId}
        className="flex flex-col gap-3 rounded-xl border border-white/8 p-4"
      >
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">System Info</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-g300">
            System type
            <input
              name="system_type"
              placeholder="e.g. ducted split, mini-split, boiler"
              defaultValue={selectedEquipment?.type ?? ""}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-g300">
            Zone config
            <input name="zone_config" placeholder="e.g. single zone, 3-zone" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-g300">
            Brand
            <input name="brand" defaultValue={selectedEquipment?.brand ?? ""} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-g300">
            Model
            <input name="model" defaultValue={selectedEquipment?.model ?? ""} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-g300">
            Serial
            <input name="serial" defaultValue={selectedEquipment?.serial_number ?? ""} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-g300">
            Refrigerant
            <input
              name="refrigerant_type"
              list="refrigerant-types"
              defaultValue={selectedEquipment?.refrigerant_type ?? ""}
              className={inputClass}
            />
            <datalist id="refrigerant-types">
              {REFRIGERANT_TYPES.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </label>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-white/8 p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Lineset Charge Calculator</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-g300">
            Lineset size
            <input name="lineset_size" placeholder={'e.g. 3/8" liquid x 3/4" suction'} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-g300">
            Total lineset length (ft)
            <input
              type="number"
              step="any"
              name="lineset_total_ft"
              value={linesetTotalFt}
              onChange={(e) => setLinesetTotalFt(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-g300">
            Factory charge (oz)
            <input
              type="number"
              step="any"
              name="factory_charge_oz"
              value={factoryCharge}
              onChange={(e) => setFactoryCharge(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-g300">
            Charge rate (oz/ft, per manufacturer spec)
            <input
              type="number"
              step="any"
              name="charge_rate_oz_per_ft"
              value={chargeRate}
              onChange={(e) => setChargeRate(e.target.value)}
              className={inputClass}
            />
          </label>
        </div>
        {additionalChargeOz !== null && (
          <div className="rounded-lg bg-white/4 p-3 text-xs text-g300">
            Calculated additional charge: <span className="font-semibold text-white">{additionalChargeOz} oz</span>
            {suggestedTotalOz !== null && (
              <>
                {" "}
                · Suggested total system charge:{" "}
                <span className="font-semibold text-white">{suggestedTotalOz} oz</span>
              </>
            )}
            <div className="mt-1">
              Many manufacturers already include a base lineset length in the factory charge — check the
              unit&apos;s data plate before applying this. Not a substitute for the manufacturer&apos;s own
              charge chart.
            </div>
            <button
              type="button"
              onClick={() => setActualCharge(String(additionalChargeOz))}
              className="mt-2 rounded border border-white/8 bg-white/6 px-2 py-1 text-[11px] font-semibold text-white hover:bg-white/10"
            >
              Use calculated value
            </button>
          </div>
        )}
        <label className="flex flex-col gap-1 text-xs text-g300">
          Actual charge added (oz)
          <input
            type="number"
            step="any"
            name="actual_charge_added_oz"
            value={actualCharge}
            onChange={(e) => setActualCharge(e.target.value)}
            className={inputClass}
          />
        </label>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-white/8 p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Nitrogen Pressure Test</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-g300">
            Test pressure held (PSIG)
            <input type="number" step="any" name="pressure_test_psig" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-g300">
            Ambient temp (°F)
            <input type="number" step="any" name="pressure_test_ambient_f" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-g300">
            Start time
            <input
              type="datetime-local"
              name="pressure_test_start_at"
              value={pStartAt}
              onChange={(e) => setPStartAt(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-g300">
            End time
            <input
              type="datetime-local"
              name="pressure_test_end_at"
              value={pEndAt}
              onChange={(e) => setPEndAt(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-g300">
            Start pressure (PSIG)
            <input
              type="number"
              step="any"
              name="pressure_test_start_psig"
              value={pStartPsig}
              onChange={(e) => setPStartPsig(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-g300">
            End pressure (PSIG)
            <input
              type="number"
              step="any"
              name="pressure_test_end_psig"
              value={pEndPsig}
              onChange={(e) => setPEndPsig(e.target.value)}
              className={inputClass}
            />
          </label>
        </div>
        {(pressureDurationMin !== null || pressureDrop !== null) && (
          <div className="rounded-lg bg-white/4 p-3 text-xs text-g300">
            {pressureDurationMin !== null && <>Held for {pressureDurationMin} min. </>}
            {pressureDrop !== null && <>Drop: {pressureDrop} PSIG. </>}
            <div className="mt-1">
              A stable reading once temperature settles generally indicates no leaks; a real drop warrants a leak
              check before evacuating. Use judgment for system size and hold time.
            </div>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-white/8 p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Vacuum &amp; Decay Test</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-g300">
            Target vacuum (microns)
            <input type="number" step="any" name="vacuum_target_microns" placeholder="e.g. 500" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-g300">
            Vacuum achieved (microns)
            <input type="number" step="any" name="vacuum_achieved_microns" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-g300">
            Decay start (microns, pump isolated)
            <input
              type="number"
              step="any"
              name="decay_start_microns"
              value={decayStart}
              onChange={(e) => setDecayStart(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-g300">
            Decay end (microns)
            <input
              type="number"
              step="any"
              name="decay_end_microns"
              value={decayEnd}
              onChange={(e) => setDecayEnd(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-g300">
            Decay duration (min)
            <input type="number" step="any" name="decay_duration_min" className={inputClass} />
          </label>
        </div>
        {decayRise !== null && (
          <div className="rounded-lg bg-white/4 p-3 text-xs text-g300">
            Rise during decay: {decayRise} microns.
            <div className="mt-1">
              A rise under ~500 microns after isolating the pump for 10-15 minutes generally indicates the system
              is free of leaks/moisture — use judgment based on system size and hold time.
            </div>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2 rounded-xl border border-white/8 p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Startup Checklist</h2>
        <div className="flex flex-col divide-y divide-white/8">
          {STARTUP_CHECKLIST_ITEMS.map((item, i) => (
            <div key={item} className="flex items-center justify-between gap-3 py-2">
              <span className="text-sm text-white">{item}</span>
              <select name={`check_${i}`} defaultValue="yes" className={inputClass}>
                <option value="yes">Yes</option>
                <option value="no">No</option>
                <option value="na">N/A</option>
              </select>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-white/8 p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Notes</h2>
        <textarea name="notes" rows={4} placeholder="Anything else worth noting" className={inputClass} />
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-white/8 bg-white/3 p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Sign-off</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-g300">
            Tech signature (typed name)
            <input name="tech_sign_name" placeholder="Tech name" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-g300">
            Customer signature (typed name)
            <input name="customer_sign_name" placeholder="Customer name" className={inputClass} />
          </label>
        </div>
      </section>

      <SubmitButton className={`${buttonClass} w-fit`} pendingText="Saving…">
        Save Install Report
      </SubmitButton>
    </form>
  );
}
