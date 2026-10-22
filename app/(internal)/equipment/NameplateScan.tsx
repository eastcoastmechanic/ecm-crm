"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { confirmDataPlate, scanDataPlate } from "./actions";
import { downscaleImage } from "@/lib/downscale-image";
import {
  NAMEPLATE_FIELDS,
  nameplateFieldLabel,
  type NameplateField,
  type NameplateIdentity,
} from "@/lib/pm/nameplate";
import { buttonClass, buttonSecondaryClass, errorClass, inputClass } from "../ui";

type DataPlateProposal = {
  identity: NameplateIdentity;
  manufacture_date_source: "printed" | "serial" | null;
  extras: Record<string, string | null>;
};

export default function NameplateScan({
  equipmentId,
  current,
}: {
  equipmentId: string;
  current: NameplateIdentity;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<DataPlateProposal | null>(null);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [values, setValues] = useState<NameplateIdentity>(current);
  const [confirmed, setConfirmed] = useState<NameplateField[]>([]);

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setScanning(true);
    setError(null);
    setProposal(null);
    try {
      const resized = await downscaleImage(file);
      const body = new FormData();
      body.set("photo", resized);
      const result = await scanDataPlate(equipmentId, body);
      if ("error" in result) {
        setError(result.error ?? "Could not read the plate");
      } else {
        setProposal(result.proposal);
        setPhotoPath(result.photoPath ?? null);
        setValues(current);
        setConfirmed([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the plate");
    } finally {
      setScanning(false);
    }
  }

  function applyScanned(field: NameplateField, checked: boolean) {
    const proposed = proposal?.identity[field] ?? "";
    setConfirmed((currentSet) =>
      checked ? [...currentSet, field] : currentSet.filter((entry) => entry !== field)
    );
    setValues((currentValues) => ({
      ...currentValues,
      [field]: checked ? proposed : current[field],
    }));
  }

  async function save() {
    if (!proposal || !photoPath) return;
    setSaving(true);
    setError(null);
    const body = new FormData();
    for (const field of NAMEPLATE_FIELDS) body.set(field, values[field] ?? "");
    for (const field of confirmed) body.set(`confirm_${field}`, "1");
    body.set("photo_path", photoPath);
    body.set("extras", JSON.stringify(proposal.extras));
    const result = await confirmDataPlate(equipmentId, body);
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setOpen(false);
    setProposal(null);
    router.refresh();
  }

  return (
    <div className="mt-2">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className={`${buttonSecondaryClass} min-h-11`}>
          Scan data plate
        </button>
      ) : (
        <div className="grid gap-3 rounded-xl border border-white/8 bg-white/3 p-3">
          <div className="text-xs font-bold uppercase tracking-wide text-g300">Data plate</div>
          <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-bold uppercase tracking-wide">
            {scanning ? "Reading plate…" : "Take plate photo"}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              disabled={scanning}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                void onPhoto(file);
              }}
            />
          </label>
          {proposal && (
            <div className="grid gap-3">
              <p className="text-xs text-g300">
                Review every field. A value already on the equipment stays until you check Replace.
                {proposal.manufacture_date_source === "serial"
                  ? " The manufacture date was decoded from the serial, not printed on the plate."
                  : ""}
              </p>
              {NAMEPLATE_FIELDS.map((field) => {
                const proposed = proposal.identity[field];
                const existing = current[field];
                const differs = Boolean(proposed && existing && proposed.trim() !== existing.trim());
                return (
                  <label key={field} className="flex flex-col gap-1 text-xs text-g300">
                    {nameplateFieldLabel(field)}
                    <input
                      value={values[field] ?? ""}
                      onChange={(e) => {
                        const next = e.target.value;
                        setValues((currentValues) => ({ ...currentValues, [field]: next }));
                        const hadValue = Boolean(existing?.trim());
                        const changed = next.trim() !== (existing ?? "").trim() && next.trim().length > 0;
                        setConfirmed((currentSet) => {
                          const without = currentSet.filter((entry) => entry !== field);
                          return hadValue && changed ? [...without, field] : without;
                        });
                      }}
                      className={inputClass}
                    />
                    {proposed ? <span>Scanned: {proposed}</span> : <span>Nothing readable for this field.</span>}
                    {differs && (
                      <span className="flex items-center gap-2 text-white">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={confirmed.includes(field)}
                          onChange={(e) => applyScanned(field, e.target.checked)}
                        />
                        Replace the value on file
                      </span>
                    )}
                  </label>
                );
              })}
              <button type="button" onClick={() => void save()} disabled={saving} className={`${buttonClass} min-h-11 w-fit`}>
                {saving ? "Saving…" : "Save confirmed plate"}
              </button>
            </div>
          )}
          {error && <p className={errorClass}>{error}</p>}
          <button type="button" onClick={() => setOpen(false)} className="w-fit text-xs text-g300 underline">
            Close
          </button>
        </div>
      )}
    </div>
  );
}
