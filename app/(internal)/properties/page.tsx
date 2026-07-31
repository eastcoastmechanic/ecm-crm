import { supabase } from "@/lib/supabase";
import AddPropertyForm from "./AddPropertyForm";
import PropertyList from "./PropertyList";
import { errorClass, headingClass, subTextClass } from "../ui";

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
        <h1 className={headingClass}>Properties</h1>
        <p className={subTextClass}>Service locations tied to each customer.</p>
      </div>

      <AddPropertyForm customers={customers ?? []} />

      {error && (
        <p className={errorClass}>Error loading properties: {error.message}</p>
      )}
      {customers?.length === 0 && (
        <p className={subTextClass}>
          Add a customer first before adding properties.
        </p>
      )}

      <PropertyList properties={properties ?? []} customers={customers ?? []} />
    </div>
  );
}
