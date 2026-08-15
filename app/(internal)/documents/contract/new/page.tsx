import { supabase } from "@/lib/supabase";
import { DEFAULT_PAYMENT_TERMS, DEFAULT_WARRANTY_TERMS } from "@/lib/contract-terms";
import ContractForm from "./ContractForm";
import { headingClass, subTextClass } from "../../../ui";

type EstimateLineItem = { category: string; description: string; qty: number; unit: string };

async function loadPrefill(estimateId: string) {
  const { data: estimate } = await supabase
    .from("documents")
    .select("customer_id, property_id, total, line_items")
    .eq("id", estimateId)
    .eq("type", "estimate")
    .single();

  if (!estimate) return null;

  const items = (estimate.line_items as { items?: EstimateLineItem[] } | null)?.items ?? [];
  const scopeOfWork = items
    .map((item) => `${item.qty} ${item.unit} — ${item.description}${item.category ? ` (${item.category})` : ""}`)
    .join("\n");

  return {
    customerId: estimate.customer_id as string | null,
    propertyId: estimate.property_id as string | null,
    price: estimate.total as number | null,
    scopeOfWork,
    fromDocumentId: estimateId,
  };
}

export default async function NewContractPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;

  const [{ data: customers }, { data: properties }, prefill] = await Promise.all([
    supabase.from("customers").select("id, name").order("name"),
    supabase.from("properties").select("id, address, customer_id").order("address"),
    from ? loadPrefill(from) : Promise.resolve(null),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={headingClass}>New Service Contract</h1>
        <p className={subTextClass}>
          A branded, e-signable contract the customer approves in the portal before work starts.
          {from && !prefill && " (Couldn't load the estimate to pre-fill from — fill it in below.)"}
        </p>
      </div>

      <ContractForm
        customers={customers ?? []}
        properties={properties ?? []}
        prefill={prefill}
        defaultPaymentTerms={DEFAULT_PAYMENT_TERMS}
        defaultWarrantyTerms={DEFAULT_WARRANTY_TERMS}
      />
    </div>
  );
}
