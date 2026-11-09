import { supabase } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/fetch-all";
import { addCustomer } from "./actions";
import CustomerList from "./CustomerList";
import SubmitButton from "../SubmitButton";
import { buttonClass, cardClass, errorClass, headingClass, inputClass, subTextClass } from "../ui";
import ResultForm from "../ResultForm";

type CustomerRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  billing_address: string | null;
  no_followups: boolean | null;
};
type PropertyRow = { id: string; address: string; customer_id: string | null };

export default async function CustomersPage() {
  // Paged: a plain select stops at 1000 rows without saying so, and the list,
  // search and Referred-by picker need every customer.
  const [customersResult, { data: properties }] = await Promise.all([
    fetchAllRows<CustomerRow>((from, to) =>
      supabase
        .from("customers")
        .select("id, name, email, phone, billing_address, no_followups")
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to)
    ),
    fetchAllRows<PropertyRow>((from, to) =>
      supabase.from("properties").select("id, address, customer_id").order("address").order("id").range(from, to)
    ),
  ]);
  const customers = customersResult.data;
  const error = customersResult.error ? { message: customersResult.error } : null;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={headingClass}>Customers</h1>
        <p className={subTextClass}>Manage your customer records.</p>
      </div>

      <ResultForm submit={addCustomer} resetOnDone className={cardClass}>
        <label className="flex flex-col gap-1 text-xs text-g300">
          Name
          <input name="name" placeholder="Name" required className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-g300">
          Company (if a business)
          <input name="company_name" placeholder="Company" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-g300">
          Second phone
          <input name="alt_phone" placeholder="Second phone" className={inputClass} />
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
        <div className="grid gap-3 rounded-xl border border-white/8 p-3 sm:col-span-2 sm:grid-cols-2">
          <div className="text-xs font-bold uppercase tracking-wide text-g300 sm:col-span-2">
            First property (optional)
          </div>
          <label className="flex flex-col gap-1 text-xs text-g300 sm:col-span-2">
            Property address
            <input name="property_address" placeholder="Job site address" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-g300">
            Property type
            <select name="property_type" defaultValue="" className={inputClass}>
              <option value="">Property type</option>
              <option value="residential">Residential</option>
              <option value="commercial">Commercial</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-g300">
            <input type="checkbox" name="billing_same" />
            Billing address is the same as the property
          </label>
          <label className="flex flex-col gap-1 text-xs text-g300 sm:col-span-2">
            Access notes (gate code, pets, parking, lockbox)
            <textarea name="access_notes" className={inputClass} />
          </label>
        </div>
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
        <label className="flex items-start gap-2 text-xs text-g300 sm:col-span-2">
          <input type="checkbox" name="no_followups" className="mt-0.5" />
          <span>
            Don&apos;t send follow-up / review requests. Stops the survey text and the follow-up email after a job.
            Appointment and scheduling texts still go out.
          </span>
        </label>
        <SubmitButton className={`${buttonClass} sm:col-span-2 sm:w-fit`}>Add Customer</SubmitButton>
      </ResultForm>

      {error && (
        <p className={errorClass}>Error loading customers: {error.message}</p>
      )}

      <CustomerList customers={customers ?? []} properties={properties ?? []} />
    </div>
  );
}
