"use client";

import { useState } from "react";
import { updateWarranty } from "./actions";
import SubmitButton from "../../SubmitButton";
import { buttonClass, inputClass } from "../../ui";
import type { WarrantyItem } from "./WarrantyDetail";

export default function WarrantyItemsEditor({
  documentId,
  technicianName,
  items,
}: {
  documentId: string;
  technicianName: string | null;
  items: WarrantyItem[];
}) {
  const [registeredByRow, setRegisteredByRow] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(items.map((item, i) => [i, item.manufacturer.registered]))
  );

  return (
    <form action={updateWarranty} className="flex flex-col gap-4 rounded-xl border border-white/8 p-4">
      <input type="hidden" name="id" value={documentId} />
      <input type="hidden" name="item_count" value={items.length} />

      <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Edit Warranty</h2>

      <label className="flex flex-col gap-1 text-xs text-g300">
        Installed by
        <input name="technician_name" defaultValue={technicianName ?? ""} className={inputClass} />
      </label>

      {items.map((item, i) => (
        <section key={i} className="flex flex-col gap-3 rounded-xl border border-white/8 p-4">
          <h3 className="text-xs font-bold uppercase tracking-wide text-g300">{item.equipment_label}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-g300">
              Model
              <input name={`model_${i}`} defaultValue={item.model ?? ""} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-g300">
              Serial number
              <input
                name={`serial_number_${i}`}
                defaultValue={item.serial_number ?? ""}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-g300">
              Date of install
              <input
                type="date"
                name={`install_date_${i}`}
                defaultValue={item.install_date ?? ""}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-g300">
              Warranty docket number
              <input
                name={`docket_number_${i}`}
                defaultValue={item.manufacturer.docket_number ?? ""}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-g300">
              Manufacturer warranty length (years)
              <input
                type="number"
                min="0"
                step="1"
                name={`manufacturer_years_${i}`}
                defaultValue={item.manufacturer.years ?? ""}
                className={inputClass}
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-g300">
              <input
                type="checkbox"
                name={`registered_${i}`}
                checked={registeredByRow[i] ?? false}
                onChange={(e) =>
                  setRegisteredByRow((prev) => ({ ...prev, [i]: e.target.checked }))
                }
              />
              Registered with manufacturer
            </label>
            {registeredByRow[i] && (
              <label className="flex flex-col gap-1 text-xs text-g300">
                Date of registry
                <input
                  type="date"
                  name={`registration_date_${i}`}
                  defaultValue={item.manufacturer.registration_date ?? ""}
                  className={inputClass}
                />
              </label>
            )}
          </div>
        </section>
      ))}

      <SubmitButton className={`${buttonClass} w-fit`} pendingText="Saving…">
        Save Changes
      </SubmitButton>
    </form>
  );
}
