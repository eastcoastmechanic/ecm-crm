import { supabase } from "@/lib/supabase";
import AssessmentForm from "./AssessmentForm";
import { headingClass, subTextClass } from "../../../ui";

export default async function NewAssessmentPage() {
  const [{ data: customers }, { data: properties }, { data: equipment }] = await Promise.all([
    supabase.from("customers").select("id, name").order("name"),
    supabase
      .from("properties")
      .select("id, address, customer_id, customers(name)")
      .order("address"),
    supabase.from("equipment").select("id, type, brand, model, property_id"),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={headingClass}>New Condition Assessment</h1>
        <p className={subTextClass}>
          Walk the property&apos;s equipment — scan nameplates, note condition — and Claude will
          write up a health summary and recommendation for each piece, plus an overall summary.
        </p>
      </div>

      <AssessmentForm
        customers={customers ?? []}
        properties={properties ?? []}
        equipment={equipment ?? []}
      />
    </div>
  );
}
