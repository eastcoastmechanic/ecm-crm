import { supabase } from "@/lib/supabase";
import { addCustomer } from "./actions";

const inputClass =
  "rounded border border-black/10 px-3 py-2 text-sm dark:border-white/10 dark:bg-transparent";

export default async function CustomersPage() {
  const { data: customers, error } = await supabase
    .from("customers")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Customers</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Manage your customer records.
        </p>
      </div>

      <form
        action={addCustomer}
        className="grid gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10 sm:grid-cols-2"
      >
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
        <button
          type="submit"
          className="rounded bg-foreground px-4 py-2 text-sm text-background sm:col-span-2 sm:w-fit"
        >
          Add Customer
        </button>
      </form>

      {error && (
        <p className="text-sm text-red-600">
          Error loading customers: {error.message}
        </p>
      )}

      <div className="flex flex-col divide-y divide-black/10 dark:divide-white/10">
        {customers?.length === 0 && (
          <p className="text-sm text-black/60 dark:text-white/60">
            No customers yet.
          </p>
        )}
        {customers?.map((customer) => (
          <div key={customer.id} className="py-3">
            <div className="font-medium">{customer.name}</div>
            <div className="text-sm text-black/60 dark:text-white/60">
              {[customer.email, customer.phone].filter(Boolean).join(" · ")}
            </div>
            {customer.billing_address && (
              <div className="text-sm text-black/60 dark:text-white/60">
                {customer.billing_address}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
