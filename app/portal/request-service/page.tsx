import { redirect } from "next/navigation";
import { createPortalServerClient } from "@/lib/supabase-portal/server";
import { requestService } from "./actions";
import SubmitButton from "../../(internal)/SubmitButton";
import { buttonClass, headingClass, inputClass, subTextClass } from "../../(internal)/ui";

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

      <form action={requestService} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-xs text-g300">
          Property
          <select name="property_id" required className={inputClass} defaultValue="">
            <option value="" disabled>
              Select property
            </option>
            {properties?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.address}
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-g300">
            Preferred date
            <input type="date" name="date" required className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-g300">
            Preferred window
            <select name="window" required className={inputClass} defaultValue="morning">
              <option value="morning">Morning (8am–12pm)</option>
              <option value="afternoon">Afternoon (12pm–4pm)</option>
              <option value="evening">Evening (4pm–6pm)</option>
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-1 text-xs text-g300">
          What&apos;s going on?
          <textarea
            name="notes"
            required
            rows={4}
            placeholder="e.g. AC isn't cooling, blowing warm air for the past two days."
            className={inputClass}
          />
        </label>

        <SubmitButton className={`${buttonClass} w-fit`} pendingText="Submitting…">
          Submit Request
        </SubmitButton>
      </form>
    </div>
  );
}
