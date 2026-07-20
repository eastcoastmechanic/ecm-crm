import { supabase } from "@/lib/supabase";
import { REFRIGERANT_TYPES } from "@/lib/refrigerant";
import { generateDiagnosis } from "./actions";
import { buttonClass, headingClass, inputClass, subTextClass } from "../../ui";

export default async function NewDiagnosticPage() {
  const { data: equipment } = await supabase
    .from("equipment")
    .select("id, type, brand, model, refrigerant_type, properties(address, customers(name))")
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={headingClass}>New Diagnostic</h1>
        <p className={subTextClass}>
          Enter field readings — Claude will calculate superheat/subcooling and diagnose the fault.
        </p>
      </div>

      <form action={generateDiagnosis} className="flex flex-col gap-6">
        <section className="flex flex-col gap-3 rounded-xl border border-white/8 p-4">
          <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Equipment</h2>
          <select name="equipment_id" required className={inputClass} defaultValue="">
            <option value="" disabled>
              Select equipment
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
          {equipment?.length === 0 && (
            <p className={subTextClass}>Add equipment first before running a diagnostic.</p>
          )}

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

        <section className="flex flex-col gap-3 rounded-xl border border-white/8 p-4">
          <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Operating Conditions</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field name="outdoor_temp" label="Outdoor Temp (°F)" placeholder="e.g. 85" />
            <Field name="indoor_temp" label="Indoor Temp (°F)" placeholder="e.g. 78" />
            <Field name="supply_air_temp" label="Supply Air Temp (°F)" placeholder="e.g. 58" />
            <Field name="return_air_temp" label="Return Air Temp (°F)" placeholder="e.g. 75" />
            <Field name="indoor_rh" label="Indoor RH %" placeholder="e.g. 52" />
          </div>
        </section>

        <section className="flex flex-col gap-3 rounded-xl border border-white/8 p-4">
          <h2 className="text-xs font-bold uppercase tracking-wide text-g300">
            Pressure Readings &amp; Refrigerant Analysis
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field name="suction_pressure" label="Suction Pressure (PSIG)" placeholder="e.g. 120" />
            <Field name="liquid_pressure" label="Liquid Pressure (PSIG)" placeholder="e.g. 265" />
            <Field name="suction_line_temp" label="Suction Line Temp (°F)" placeholder="e.g. 52" />
            <Field name="liquid_line_temp" label="Liquid Line Temp (°F)" placeholder="e.g. 90" />
            <Field name="discharge_pressure" label="Discharge Pressure (PSIG)" placeholder="e.g. 285" />
            <Field name="discharge_temp" label="Discharge Temp (°F)" placeholder="e.g. 180" />
          </div>
        </section>

        <section className="flex flex-col gap-3 rounded-xl border border-white/8 p-4">
          <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Electrical</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field name="amp_draw" label="Compressor Amp Draw (A)" placeholder="e.g. 14.2" />
            <Field name="voltage" label="Line Voltage (V)" placeholder="e.g. 240" />
          </div>
        </section>

        <section className="flex flex-col gap-3 rounded-xl border border-white/8 p-4">
          <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Symptoms</h2>
          <textarea
            name="symptoms"
            required
            rows={4}
            placeholder="What's the customer reporting? What did you observe on site? e.g. 'Not cooling, warm air from vents, unit ices up after running 20 min.'"
            className={inputClass}
          />
        </section>

        <button type="submit" className={`${buttonClass} w-fit`}>
          Generate Diagnosis
        </button>
      </form>
    </div>
  );
}

function Field({ name, label, placeholder }: { name: string; label: string; placeholder: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-g300">
      {label}
      <input type="number" step="any" name={name} placeholder={placeholder} className={inputClass} />
    </label>
  );
}
