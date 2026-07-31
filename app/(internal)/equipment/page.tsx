import { supabase } from "@/lib/supabase";
import EquipmentForm from "./EquipmentForm";
import EquipmentList from "./EquipmentList";
import { errorClass, headingClass, subTextClass } from "../ui";

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

      <EquipmentForm properties={properties ?? []} />

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
