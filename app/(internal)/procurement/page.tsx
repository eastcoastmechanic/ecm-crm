import { supabase } from "@/lib/supabase";
import ProcurementList, { type PurchaseOrder, type JobOption } from "./ProcurementList";
import { headingClass, subTextClass, errorClass } from "../ui";

export const dynamic = "force-dynamic";

export default async function ProcurementPage() {
  const [{ data: purchaseOrders, error }, { data: openJobs }] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select("*, jobs(id, scheduled_at, customers(name), properties(address))")
      .order("created_at", { ascending: false }),
    supabase
      .from("jobs")
      .select("id, scheduled_at, customers(name), properties(address)")
      .neq("status", "cancelled")
      .order("scheduled_at", { ascending: false })
      .limit(100),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={headingClass}>Procurement</h1>
        <p className={subTextClass}>
          Parts and equipment on order — from vendor selection through delivery.
        </p>
      </div>

      {error && <p className={errorClass}>Error loading purchase orders: {error.message}</p>}

      <ProcurementList
        purchaseOrders={(purchaseOrders ?? []) as unknown as PurchaseOrder[]}
        jobOptions={(openJobs ?? []) as unknown as JobOption[]}
      />
    </div>
  );
}
