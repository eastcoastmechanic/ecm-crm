import { supabase } from "@/lib/supabase";
import { addCustomer } from "./actions";
import {
  buttonClass,
  cardClass,
  errorClass,
  headingClass,
  inputClass,
  itemSubClass,
  itemTitleClass,
  subTextClass,
} from "../ui";

export default async function CustomersPage() {
  const { data: customers, error } = await supabase
    .from("customers")
    .select("*")
    .order("created_at", { ascending: false });

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

      <div className="flex flex-col divide-y divide-white/8">
        {customers?.length === 0 && (
          <p className={subTextClass}>No customers yet.</p>
        )}
        {customers?.map((customer) => (
          <div key={customer.id} className="py-3">
            <div className={itemTitleClass}>{customer.name}</div>
            <div className={itemSubClass}>
              {[customer.email, customer.phone].filter(Boolean).join(" · ")}
            </div>
            {customer.billing_address && (
              <div className={itemSubClass}>{customer.billing_address}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
