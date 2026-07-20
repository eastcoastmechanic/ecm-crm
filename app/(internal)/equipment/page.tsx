import { supabase } from "@/lib/supabase";
import { addEquipment } from "./actions";
import EquipmentList from "./EquipmentList";
import { buttonClass, cardClass, errorClass, headingClass, inputClass, subTextClass } from "../ui";

export default async function EquipmentPage() {
  const [{ data: equipment, error }, { data: properties }] = await Promise.all([
    supabase
      .from("equipment")
      .select("*, properties(address, customers(name))")
      .order("created_at", { ascending: false }),
    supabase
      .from("properties")
      .select("id, address, customers(name)")
      .order("address"),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={headingClass}>Equipment</h1>
        <p className={subTextClass}>Installed equipment tied to each property.</p>
      </div>

      <form action={addEquipment} className={cardClass}>
        <select name="property_id" required className={inputClass} defaultValue="">
          <option value="" disabled>
            Select property
          </option>
          {properties?.map((property) => (
            <option key={property.id} value={property.id}>
              {property.address}
              {property.customers?.[0]?.name
                ? ` — ${property.customers[0].name}`
                : ""}
            </option>
          ))}
        </select>
        <input
          name="type"
          placeholder="Type (e.g. mini-split, boiler)"
          required
          className={inputClass}
        />
        <input name="brand" placeholder="Brand" className={inputClass} />
        <input name="model" placeholder="Model" className={inputClass} />
        <input
          name="serial_number"
          placeholder="Serial number"
          className={inputClass}
        />
        <label className="flex flex-col gap-1 text-xs text-g300">
          Install date
          <input name="install_date" type="date" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-g300">
          Warranty expiration
          <input name="warranty_expiration" type="date" className={inputClass} />
        </label>
        <button type="submit" className={`${buttonClass} sm:col-span-2 sm:w-fit`}>
          Add Equipment
        </button>
      </form>

      {error && (
        <p className={errorClass}>Error loading equipment: {error.message}</p>
      )}
      {properties?.length === 0 && (
        <p className={subTextClass}>
          Add a property first before adding equipment.
        </p>
      )}

      <EquipmentList equipment={equipment ?? []} properties={properties ?? []} />
    </div>
  );
}
