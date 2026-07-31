import { supabase } from "@/lib/supabase";
import { addCustomer } from "./actions";
import CustomerList from "./CustomerList";
import SubmitButton from "../SubmitButton";
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
        <label className="flex flex-col gap-1 text-xs text-g300">
          Name
          <input name="name" placeholder="Name" required className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-g300">
          Email
          <input name="email" type="email" placeholder="Email" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-g300">
          Phone
          <input name="phone" placeholder="Phone" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-g300">
          Billing address
          <input name="billing_address" placeholder="Billing address" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-g300">
          Referred by
          <select name="referred_by_customer_id" defaultValue="" className={inputClass}>
            <option value="">No referral</option>
            {(customers ?? []).map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-g300 sm:col-span-2">
          Notes
          <textarea name="notes" placeholder="Notes" className={inputClass} />
        </label>
        <label className="flex items-start gap-2 text-xs text-g300 sm:col-span-2">
          <input type="checkbox" name="sms_consent" className="mt-0.5" />
          <span>
            Customer has verbally agreed to receive text messages about their appointments (message
            frequency varies, msg &amp; data rates may apply, reply STOP to opt out anytime).
          </span>
        </label>
        <SubmitButton className={`${buttonClass} sm:col-span-2 sm:w-fit`}>Add Customer</SubmitButton>
      </form>

      {error && (
        <p className={errorClass}>Error loading customers: {error.message}</p>
      )}

      <CustomerList customers={customers ?? []} properties={properties ?? []} />
    </div>
  );
}
