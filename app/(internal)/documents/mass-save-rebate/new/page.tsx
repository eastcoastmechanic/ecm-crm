import { supabase } from "@/lib/supabase";
import MassSaveRebateForm from "./MassSaveRebateForm";
import { headingClass, subTextClass } from "../../../ui";

export default async function NewMassSaveRebatePage() {
  const [{ data: customers }, { data: properties }, { data: equipment }] = await Promise.all([
    supabase.from("customers").select("id, name, email, phone").order("name"),
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
        <h1 className={headingClass}>New Mass Save Rebate Application</h1>
        <p className={subTextClass}>
          Fills the real 2026 Residential Air Source Heat Pump Rebate Form from CRM data and
          nameplate photo scans — review it before submitting, and have the customer sign the
          printed copy.
        </p>
      </div>

      <MassSaveRebateForm
        customers={customers ?? []}
        properties={properties ?? []}
        equipment={equipment ?? []}
        installerDefaults={{
          phone: process.env.BUSINESS_PHONE ?? "",
          address: process.env.SHOP_ADDRESS ?? "",
        }}
      />
    </div>
  );
}
