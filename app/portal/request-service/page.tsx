import { supabase as adminDb } from "@/lib/supabase";
import { portalCustomerFor, requirePortalUser } from "@/lib/portal-customer";
import RequestServiceForm from "./RequestServiceForm";
import { headingClass, subTextClass } from "../../(internal)/ui";

export default async function RequestServicePage() {
  const user = await requirePortalUser();

  // Read on the server, scoped to this customer's own properties.
  const customer = await portalCustomerFor(user.id);
  const { data: properties } = customer
    ? await adminDb.from("properties").select("id, address").eq("customer_id", customer.id)
    : { data: [] };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className={headingClass}>Request Service</h1>
        <p className={subTextClass}>
          Tell us what&apos;s going on and pick a preferred day — we&apos;ll confirm a time.
        </p>
      </div>

      <RequestServiceForm properties={properties ?? []} />
    </div>
  );
}
