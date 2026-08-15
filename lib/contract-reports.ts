import { supabase } from "@/lib/supabase";
import type { ContractPdfData } from "@/lib/contract-pdf";
import type { ContractLineItems } from "@/lib/contract-terms";

export async function getContractForPdf(id: string): Promise<{
  data: ContractPdfData | null;
  customerEmail: string | null;
  error: string | null;
}> {
  const { data: doc, error } = await supabase
    .from("documents")
    .select("*, customers(name, email, phone), properties(address)")
    .eq("id", id)
    .single();

  if (error || !doc) {
    return { data: null, customerEmail: null, error: error?.message ?? "Contract not found" };
  }

  const lineData = doc.line_items as ContractLineItems;

  return {
    data: {
      doc_number: doc.doc_number,
      created_at: doc.created_at,
      customer_name: doc.customers?.name ?? "Customer",
      customer_phone: doc.customers?.phone ?? null,
      customer_email: doc.customers?.email ?? null,
      property_address: doc.properties?.address ?? null,
      scope_of_work: lineData.scopeOfWork,
      payment_terms: lineData.paymentTerms,
      warranty_terms: lineData.warrantyTerms,
      start_date: lineData.startDate,
      estimated_completion: lineData.estimatedCompletion,
      notes: lineData.notes,
      total: doc.total,
      status: doc.status,
      signed_at: doc.signed_at,
      signature_data: doc.signature_data,
    },
    customerEmail: doc.customers?.email ?? null,
    error: null,
  };
}
