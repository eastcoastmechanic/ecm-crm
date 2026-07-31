import { supabase } from "@/lib/supabase";
import NewDocumentForm from "./NewDocumentForm";
import { headingClass, subTextClass } from "../../ui";

export default async function NewDocumentPage() {
  const [{ data: customers }, { data: properties }] = await Promise.all([
    supabase.from("customers").select("id, name").order("name"),
    supabase
      .from("properties")
      .select("id, address, customer_id, customers(name)")
      .order("address"),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={headingClass}>New Document</h1>
        <p className={subTextClass}>
          Describe the job — Claude will build a Good/Better/Best estimate
          from the live price book.
        </p>
      </div>

      <NewDocumentForm customers={customers ?? []} properties={properties ?? []} />
    </div>
  );
}
