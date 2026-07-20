import { supabase } from "@/lib/supabase";
import { addCustomer } from "./actions";
import CustomerList from "./CustomerList";
import { buttonClass, cardClass, errorClass, headingClass, inputClass, subTextClass } from "../ui";

export default async function CustomersPage() {
  const [{ data: customers, error }, { data: properties }] = await Promise.all([
    supabase.from("customers").select("*").order("created_at", { ascending: false }),
    supabase.from("properties").select("id, address, customer_id").order("address"),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={headingClass}>Customers</h1>
        <p className={subTextClass}>Manage your customer records.</p>
      </div>

      <form action={addCustomer} className={cardClass}>
        <input name="name" placeholder="Name" required className={inputClass} />
        <input name="email" type="email" placeholder="Email" className={inputClass} />
        <input name="phone" placeholder="Phone" className={inputClass} />
        <input
          name="billing_address"
          placeholder="Billing address"
          className={inputClass}
        />
        <textarea
          name="notes"
          placeholder="Notes"
          className={`${inputClass} sm:col-span-2`}
        />
        <button type="submit" className={`${buttonClass} sm:col-span-2 sm:w-fit`}>
          Add Customer
        </button>
      </form>

      {error && (
        <p className={errorClass}>Error loading customers: {error.message}</p>
      )}

      <CustomerList customers={customers ?? []} properties={properties ?? []} />
    </div>
  );
}
