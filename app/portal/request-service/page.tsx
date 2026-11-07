import { redirect } from "next/navigation";
import { createPortalServerClient } from "@/lib/supabase-portal/server";
import RequestServiceForm from "./RequestServiceForm";
import { headingClass, subTextClass } from "../../(internal)/ui";

export default async function RequestServicePage() {
  const supabase = await createPortalServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/portal/login");

  const { data: customer } = await supabase.from("customers").select("id").limit(1).maybeSingle();
  const { data: properties } = customer
    ? await supabase.from("properties").select("id, address").eq("customer_id", customer.id)
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
