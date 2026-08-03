import { supabase } from "@/lib/supabase";
import WarrantyForm from "./WarrantyForm";
import { headingClass, subTextClass } from "../../../ui";

export default async function NewWarrantyPage() {
  const [{ data: customers }, { data: properties }, { data: equipment }] = await Promise.all([
    supabase.from("customers").select("id, name").order("name"),
    supabase
      .from("properties")
      .select("id, address, customer_id, customers(name)")
      .order("address"),
    supabase
      .from("equipment")
      .select("id, type, brand, model, serial_number, install_date, property_id"),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={headingClass}>New Warranty Registration</h1>
        <p className={subTextClass}>
          Record the manufacturer warranty for a piece of equipment, plus ECM&apos;s standard 1-year
          craftsmanship warranty on the install.
        </p>
      </div>

      <WarrantyForm
        customers={customers ?? []}
        properties={properties ?? []}
        equipment={equipment ?? []}
      />
    </div>
  );
}
