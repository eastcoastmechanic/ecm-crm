"use client";

import { useMemo, useState } from "react";
import { submitMassSaveRebate, scanEquipmentLabel, type ScannedEquipmentLabel } from "./actions";
import SubmitButton from "../../../SubmitButton";
import { buttonClass, buttonSecondaryClass, errorClass, inputClass, subTextClass } from "../../../ui";
import CustomerPicker from "../../../CustomerPicker";
import PropertyPicker from "../../../PropertyPicker";

type Customer = { id: string; name: string; email: string | null; phone: string | null };
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

const RADIO_CLASS = "flex items-center gap-1.5 text-xs text-g300";

function Radio({
  name,
  value,
  label,
}: {
  name: string;
  value: string;
  label: string;
}) {
  return (
    <label className={RADIO_CLASS}>
      <input type="radio" name={name} value={value} />
      {label}
    </label>
  );
}

export default function MassSaveRebateForm({
  customers,
  properties,
  equipment,
  installerDefaults,
}: {
  customers: Customer[];
  properties: Property[];
  equipment: Equipment[];
  installerDefaults: { phone: string; address: string };
}) {
  const [customerId, setCustomerId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [housingType, setHousingType] = useState("");
  const [rowIds, setRowIds] = useState<number[]>(() => [nextRowId++]);
  const [equipmentIdByRow, setEquipmentIdByRow] = useState<Record<number, string>>({});
  const [ahriByRow, setAhriByRow] = useState<Record<number, string>>({});
  const [btuByRow, setBtuByRow] = useState<Record<number, string>>({});
  const [scanningRow, setScanningRow] = useState<number | null>(null);
  const [scanError, setScanError] = useState<Record<number, string>>({});
  const [scanned, setScanned] = useState<Record<number, ScannedEquipmentLabel | null>>({});

  const propertyEquipment = useMemo(
    () => equipment.filter((e) => e.property_id === propertyId),
    [equipment, propertyId]
  );

  function addRow() {
    if (rowIds.length >= 3) return; // the official form has 3 equipment rows
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
      const result = await scanEquipmentLabel(formData);
      setScanned((prev) => ({ ...prev, [rowId]: result }));
      if (result.ahri_reference) setAhriByRow((prev) => ({ ...prev, [rowId]: result.ahri_reference! }));
      if (result.cooling_capacity_btu)
        setBtuByRow((prev) => ({ ...prev, [rowId]: String(result.cooling_capacity_btu) }));
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
    <form action={submitMassSaveRebate} className="flex flex-col gap-4">
      <input type="hidden" name="equipment_row_count" value={rowIds.length} />

      <div className="grid gap-3 rounded-xl border border-white/8 bg-white/3 p-4 sm:grid-cols-2">
        <CustomerPicker customers={customers} value={customerId} onChange={setCustomerId} />
        <PropertyPicker
          properties={properties}
          customerId={customerId}
          value={propertyId}
          onChange={setPropertyId}
        />
      </div>

      <section className="flex flex-col gap-3 rounded-xl border border-white/8 p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Mass Save Sponsor</h2>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-g300">Electric sponsor</span>
          <div className="flex flex-wrap gap-3">
            <Radio name="electric_sponsor" value="cape_light_compact" label="Cape Light Compact" />
            <Radio name="electric_sponsor" value="eversource" label="Eversource" />
            <Radio name="electric_sponsor" value="national_grid" label="National Grid" />
            <Radio name="electric_sponsor" value="unitil" label="Unitil" />
            <Radio name="electric_sponsor" value="other" label="Other" />
          </div>
        </div>
        <input
          name="electric_account_number"
          placeholder="Electric account number"
          className={inputClass}
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-g300">Gas sponsor (only if displacing natural gas)</span>
          <div className="flex flex-wrap gap-3">
            <Radio name="gas_sponsor" value="berkshire_gas" label="Berkshire Gas" />
            <Radio name="gas_sponsor" value="eversource" label="Eversource" />
            <Radio name="gas_sponsor" value="liberty" label="Liberty" />
            <Radio name="gas_sponsor" value="national_grid" label="National Grid" />
            <Radio name="gas_sponsor" value="unitil" label="Unitil" />
          </div>
        </div>
        <input name="gas_account_number" placeholder="Natural gas account number" className={inputClass} />
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-white/8 p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Project Information</h2>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-g300">Is this property occupied by an owner or a renter?</span>
          <div className="flex gap-3">
            <Radio name="occupancy" value="owner" label="Owner" />
            <Radio name="occupancy" value="renter" label="Renter" />
          </div>
        </div>
        <input
          name="assessment_site_id"
          placeholder="Assessment Site ID (from Home Energy Assessment, if any)"
          className={inputClass}
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-g300">Housing type</span>
          <div className="flex flex-wrap gap-3">
            <Radio name="housing_type" value="single_family" label="Single-Family" />
            <label className={RADIO_CLASS}>
              <input
                type="radio"
                name="housing_type"
                value="2_4_unit"
                onChange={() => setHousingType("2_4_unit")}
              />
              2-4 unit building
            </label>
            <label className={RADIO_CLASS}>
              <input
                type="radio"
                name="housing_type"
                value="5_plus_unit"
                onChange={() => setHousingType("5_plus_unit")}
              />
              5+ unit building
            </label>
          </div>
        </div>
        <input
          name="total_square_footage"
          placeholder="Total home square footage"
          className={inputClass}
        />
        {housingType === "2_4_unit" && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-g300">Units the heat pump system(s) will heat and cool</span>
            <div className="flex gap-3">
              {["1", "2", "3", "4"].map((n) => (
                <Radio key={n} name="multi_unit_count" value={n} label={n} />
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-g300">Pre-existing heating type</span>
          <div className="flex flex-wrap gap-3">
            <Radio name="pre_existing_heating" value="oil" label="Oil" />
            <Radio name="pre_existing_heating" value="propane" label="Propane" />
            <Radio name="pre_existing_heating" value="electric_resistance" label="Electric Resistance" />
            <Radio name="pre_existing_heating" value="natural_gas" label="Natural Gas" />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-g300">Rebate type requested (select all that apply)</span>
          <div className="flex flex-wrap gap-3">
            {[
              ["whole_home", "Whole-Home Rebate"],
              ["partial_home", "Partial-Home Rebate"],
              ["weatherization_bonus", "Weatherization Bonus"],
              ["sizing_bonus", "Sizing Bonus"],
            ].map(([value, label]) => (
              <label key={value} className={RADIO_CLASS}>
                <input type="checkbox" name="rebate_types" value={value} />
                {label}
              </label>
            ))}
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-white/8 p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">
          Integrated Control (if propane/oil/gas remains in use for part of the home)
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <input name="ic_model" placeholder="IC Model #" className={inputClass} />
          <input name="ic_switchover_temp" placeholder="IC switchover temperature" className={inputClass} />
          <input name="ic_count" placeholder="Number of ICs" className={inputClass} />
          <input name="ic_location" placeholder="Location of ICs" className={inputClass} />
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-white/8 p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-g300">
          Installer Information (East Coast Mechanical)
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            name="installer_company_name"
            defaultValue="East Coast Mechanical"
            placeholder="Company name"
            className={inputClass}
          />
          <input name="installer_hpin_id" placeholder="HPIN Company ID" className={inputClass} />
          <input name="installer_contact_person" placeholder="Contact person" className={inputClass} />
          <input
            name="installer_phone"
            defaultValue={installerDefaults.phone}
            placeholder="Phone"
            className={inputClass}
          />
          <input name="installer_email" placeholder="Email" className={inputClass} />
          <input
            name="installer_address"
            defaultValue={installerDefaults.address}
            placeholder="Mailing address"
            className={inputClass}
          />
          <input name="installer_city" placeholder="City" className={inputClass} />
          <input name="installer_state" defaultValue="MA" placeholder="State" className={inputClass} />
          <input name="installer_zip" placeholder="ZIP" className={inputClass} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-g300">Payee for rebate</span>
          <div className="flex gap-3">
            <Radio name="payee" value="customer" label="Customer" />
            <Radio name="payee" value="installer" label="Installer" />
            <Radio name="payee" value="other" label="Other" />
          </div>
        </div>
      </section>

      <h2 className="text-xs font-bold uppercase tracking-wide text-g300">
        Equipment Installed (up to 3, matching the official form)
      </h2>

      {rowIds.map((rowId, index) => (
        <section key={rowId} className="flex flex-col gap-3 rounded-xl border border-white/8 p-4">
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
            Equipment on file
            <select
              className={inputClass}
              value={equipmentIdByRow[rowId] ?? ""}
              onChange={(e) =>
                setEquipmentIdByRow((prev) => ({ ...prev, [rowId]: e.target.value }))
              }
            >
              <option value="">Not on file / new</option>
              {propertyEquipment.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.type}
                  {e.brand ? ` — ${e.brand}` : ""}
                  {e.model ? ` ${e.model}` : ""}
                </option>
              ))}
            </select>
            <input type="hidden" name={`equipment_id_${index}`} value={equipmentIdByRow[rowId] ?? ""} />
          </label>

          <div className="flex flex-col gap-2 rounded-lg border border-white/8 bg-white/3 p-3">
            <label className="text-xs text-g300">
              Scan nameplate / AHRI label photo — auto-fills AHRI reference &amp; BTUs when shown
            </label>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => handleScan(rowId, e)}
              className={inputClass}
            />
            {scanningRow === rowId && <p className="text-xs text-g300">Reading label…</p>}
            {scanError[rowId] && <p className={errorClass}>{scanError[rowId]}</p>}
            {scanned[rowId]?.brand && (
              <p className="text-xs text-g300">
                Read: {scanned[rowId]?.brand} {scanned[rowId]?.model}
                {scanned[rowId]?.serial_number ? ` (S/N ${scanned[rowId]?.serial_number})` : ""}
              </p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-g300">
              Install date
              <input type="date" name={`eq_install_date_${index}`} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-g300">
              AHRI Certified Reference #
              <input
                name={`eq_ahri_${index}`}
                value={ahriByRow[rowId] ?? ""}
                onChange={(e) => setAhriByRow((prev) => ({ ...prev, [rowId]: e.target.value }))}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-g300">
              AHRI cooling capacity (BTUs)
              <input
                name={`eq_btu_${index}`}
                value={btuByRow[rowId] ?? ""}
                onChange={(e) => setBtuByRow((prev) => ({ ...prev, [rowId]: e.target.value }))}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-g300">
              Number of tons (1 ton = 12,000 BTU)
              <input name={`eq_tons_${index}`} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-g300">
              Area served (sq ft)
              <input name={`eq_area_${index}`} className={inputClass} />
            </label>
          </div>
        </section>
      ))}

      {rowIds.length < 3 && (
        <button type="button" onClick={addRow} className={`${buttonSecondaryClass} w-fit`}>
          + Add Another Piece of Equipment
        </button>
      )}

      {customers.length === 0 && (
        <p className={subTextClass}>Add a customer first before creating a rebate application.</p>
      )}

      <SubmitButton className={`${buttonClass} w-fit`} pendingText="Saving…">
        Save Rebate Application
      </SubmitButton>
    </form>
  );
}
