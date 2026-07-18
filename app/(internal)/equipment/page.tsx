import { supabase } from "@/lib/supabase";
import { addEquipment } from "./actions";

const inputClass =
  "rounded border border-black/10 px-3 py-2 text-sm dark:border-white/10 dark:bg-transparent";

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
        <h1 className="text-2xl font-semibold">Equipment</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Installed equipment tied to each property.
        </p>
      </div>

      <form
        action={addEquipment}
        className="grid gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10 sm:grid-cols-2"
      >
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
        <label className="flex flex-col gap-1 text-xs text-black/60 dark:text-white/60">
          Install date
          <input name="install_date" type="date" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-black/60 dark:text-white/60">
          Warranty expiration
          <input name="warranty_expiration" type="date" className={inputClass} />
        </label>
        <button
          type="submit"
          className="rounded bg-foreground px-4 py-2 text-sm text-background sm:col-span-2 sm:w-fit"
        >
          Add Equipment
        </button>
      </form>

      {error && (
        <p className="text-sm text-red-600">
          Error loading equipment: {error.message}
        </p>
      )}
      {properties?.length === 0 && (
        <p className="text-sm text-black/60 dark:text-white/60">
          Add a property first before adding equipment.
        </p>
      )}

      <div className="flex flex-col divide-y divide-black/10 dark:divide-white/10">
        {equipment?.length === 0 && (
          <p className="text-sm text-black/60 dark:text-white/60">
            No equipment yet.
          </p>
        )}
        {equipment?.map((item) => (
          <div key={item.id} className="py-3">
            <div className="font-medium">
              {item.type}
              {item.brand ? ` — ${item.brand}` : ""}
              {item.model ? ` ${item.model}` : ""}
            </div>
            <div className="text-sm text-black/60 dark:text-white/60">
              {item.properties?.address}
              {item.properties?.customers?.name
                ? ` — ${item.properties.customers.name}`
                : ""}
            </div>
            <div className="text-sm text-black/60 dark:text-white/60">
              {[
                item.serial_number ? `SN ${item.serial_number}` : null,
                item.install_date ? `Installed ${item.install_date}` : null,
                item.warranty_expiration
                  ? `Warranty until ${item.warranty_expiration}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
