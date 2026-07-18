import { supabase } from "@/lib/supabase";
import { generateDocument } from "./actions";
import { buttonClass, headingClass, inputClass, subTextClass } from "../../ui";

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

      <form action={generateDocument} className="flex flex-col gap-4">
        <div className="grid gap-3 rounded-xl border border-white/8 bg-white/3 p-4 sm:grid-cols-2">
          <select name="type" required className={inputClass} defaultValue="estimate">
            <option value="estimate">Estimate</option>
            <option value="invoice">Invoice</option>
            <option value="proposal">Proposal</option>
          </select>
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
          <select
            name="property_id"
            className={`${inputClass} sm:col-span-2`}
            defaultValue=""
          >
            <option value="">No property (general estimate)</option>
            {properties?.map((property) => (
              <option key={property.id} value={property.id}>
                {property.address}
                {property.customers?.[0]?.name
                  ? ` — ${property.customers[0].name}`
                  : ""}
              </option>
            ))}
          </select>
          <textarea
            name="raw_request"
            required
            placeholder="Describe the job in plain language — e.g. 'Replace 2-zone ductless system in the main house, customer wants heat pump water heater too, mention MassSave rebates.'"
            className={`${inputClass} min-h-32 sm:col-span-2`}
          />
        </div>

        {customers?.length === 0 && (
          <p className={subTextClass}>Add a customer first before generating a document.</p>
        )}

        <button type="submit" className={`${buttonClass} w-fit`}>
          ⚡ Generate Document
        </button>
      </form>
    </div>
  );
}
