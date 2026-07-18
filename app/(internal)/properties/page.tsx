import { supabase } from "@/lib/supabase";
import { addProperty } from "./actions";

const inputClass =
  "rounded border border-black/10 px-3 py-2 text-sm dark:border-white/10 dark:bg-transparent";

export default async function PropertiesPage() {
  const [{ data: properties, error }, { data: customers }] = await Promise.all([
    supabase
      .from("properties")
      .select("*, customers(name)")
      .order("created_at", { ascending: false }),
    supabase.from("customers").select("id, name").order("name"),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Properties</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Service locations tied to each customer.
        </p>
      </div>

      <form
        action={addProperty}
        className="grid gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10 sm:grid-cols-2"
      >
        <select name="customer_id" required className={inputClass} defaultValue="">
          <option value="" disabled>
            Select customer
          </option>
          {customers?.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name}
            </option>
          ))}
        </select>
        <select name="property_type" className={inputClass} defaultValue="">
          <option value="">Property type</option>
          <option value="residential">Residential</option>
          <option value="commercial">Commercial</option>
        </select>
        <input
          name="address"
          placeholder="Address"
          required
          className={`${inputClass} sm:col-span-2`}
        />
        <button
          type="submit"
          className="rounded bg-foreground px-4 py-2 text-sm text-background sm:col-span-2 sm:w-fit"
        >
          Add Property
        </button>
      </form>

      {error && (
        <p className="text-sm text-red-600">
          Error loading properties: {error.message}
        </p>
      )}
      {customers?.length === 0 && (
        <p className="text-sm text-black/60 dark:text-white/60">
          Add a customer first before adding properties.
        </p>
      )}

      <div className="flex flex-col divide-y divide-black/10 dark:divide-white/10">
        {properties?.length === 0 && (
          <p className="text-sm text-black/60 dark:text-white/60">
            No properties yet.
          </p>
        )}
        {properties?.map((property) => (
          <div key={property.id} className="py-3">
            <div className="font-medium">{property.address}</div>
            <div className="text-sm text-black/60 dark:text-white/60">
              {property.customers?.name}
              {property.property_type ? ` · ${property.property_type}` : ""}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
