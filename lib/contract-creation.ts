import { supabase } from "@/lib/supabase";
import { syncDocumentToGraph } from "@/lib/graph-connector";
import { DEFAULT_PAYMENT_TERMS, DEFAULT_WARRANTY_TERMS, type ContractLineItems } from "@/lib/contract-terms";

async function nextContractNumber(): Promise<string> {
  const { count } = await supabase
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("type", "contract");
  return `CON-${1000 + (count ?? 0) + 1}`;
}

export type CreateContractInput = {
  customerId: string;
  propertyId: string;
  price: number;
  scopeOfWork: string;
  paymentTerms?: string | null;
  warrantyTerms?: string | null;
  startDate?: string | null;
  estimatedCompletion?: string | null;
  notes?: string | null;
  fromDocumentId?: string | null;
};

export type CreateContractResult = { documentId: string; docNumber: string };

export async function createContract(input: CreateContractInput): Promise<CreateContractResult> {
  if (!input.scopeOfWork?.trim()) throw new Error("Scope of work is required");
  if (!(input.price > 0)) throw new Error("Contract price must be greater than zero");

  const docNumber = await nextContractNumber();

  const lineItems: ContractLineItems = {
    scopeOfWork: input.scopeOfWork.trim(),
    paymentTerms: input.paymentTerms?.trim() || DEFAULT_PAYMENT_TERMS,
    warrantyTerms: input.warrantyTerms?.trim() || DEFAULT_WARRANTY_TERMS,
    startDate: input.startDate || null,
    estimatedCompletion: input.estimatedCompletion || null,
    notes: input.notes?.trim() || null,
    fromDocumentId: input.fromDocumentId || null,
  };

  const { data: document, error } = await supabase
    .from("documents")
    .insert({
      doc_number: docNumber,
      type: "contract",
      customer_id: input.customerId,
      property_id: input.propertyId,
      status: "draft",
      ai_generated: false,
      line_items: lineItems,
      total: Math.round(input.price * 100) / 100,
    })
    .select("id")
    .single();

  if (error || !document) throw new Error(error?.message ?? "Failed to create contract");

  await syncDocumentToGraph(document.id);

  return { documentId: document.id, docNumber };
}
