import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { supabase } from "@/lib/supabase";
import { claude, CLAUDE_MODEL } from "@/lib/claude";
import { fetchAllPriceBookItems, formatPriceBookForPrompt } from "@/lib/price-book";
import { resolveCustomerPropertyEquipment } from "@/lib/customer-intake";
import { buildFileContentBlocks } from "@/lib/vision-extract";

const LineItemSchema = z.object({
  category: z.string(),
  description: z.string(),
  price_book_item_name: z.string().nullable(),
  qty: z.number(),
  unit: z.string(),
  good: z.number().nullable(),
  better: z.number().nullable(),
  best: z.number().nullable(),
  notes: z.string().nullable(),
});

const GeneratedDocumentSchema = z.object({
  option_label: z
    .string()
    .nullable()
    .describe(
      "Short label like 'Option A: Heat Pump System' — only when this is one of several distinct options for the same job. Null when there's a single document."
    ),
  job_description: z.string(),
  brand: z.object({
    good: z.string().nullable(),
    better: z.string().nullable(),
    best: z.string().nullable(),
  }),
  line_items: z.array(LineItemSchema),
  mass_save_eligible: z.boolean(),
  mass_save_note: z.string().nullable(),
});

const GeneratedDocSchema = z.object({
  documents: z
    .array(GeneratedDocumentSchema)
    .min(1)
    .describe(
      "One entry per document to create. Almost always length 1. Only length > 1 when the job explicitly describes multiple distinct, mutually exclusive options that each need their own separate pricing."
    ),
});

const DOC_PREFIX: Record<string, string> = {
  estimate: "EST",
  invoice: "INV",
  proposal: "PROP",
};

async function nextDocNumber(type: string) {
  const { count } = await supabase
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("type", type);
  const seq = 1001 + (count ?? 0);
  return `${DOC_PREFIX[type]}-${seq}`;
}

async function uploadDocumentPhotos(files: File[]) {
  const uploaded: { url: string; name: string }[] = [];
  for (const file of files) {
    if (!file || file.size === 0) continue;
    const path = `${crypto.randomUUID()}-${file.name}`;
    const { error } = await supabase.storage.from("document-photos").upload(path, file, {
      contentType: file.type,
    });
    if (error) throw new Error(`Failed to upload ${file.name}: ${error.message}`);
    const { data: publicUrl } = supabase.storage.from("document-photos").getPublicUrl(path);
    uploaded.push({ url: publicUrl.publicUrl, name: file.name });
  }
  return uploaded;
}

function sumTier(items: z.infer<typeof LineItemSchema>[], tier: "good" | "better" | "best") {
  const total = items.reduce((sum, item) => {
    const price = item[tier];
    return price === null ? sum : sum + price * item.qty;
  }, 0);
  return Math.round(total * 100) / 100;
}

export type GenerateDocumentInput = {
  customerId?: string | null;
  customerName?: string | null;
  phone?: string | null;
  email?: string | null;
  smsConsent?: boolean;
  propertyId?: string | null;
  address?: string | null;
  type: "estimate" | "invoice" | "proposal";
  rawRequest: string;
  photos?: File[];
};

export type GenerateDocumentResult = {
  documentId: string;
  docNumber: string;
  optionLabel: string | null;
  totals: { good: number; better: number; best: number };
};

/**
 * Core of the AI document generator: given a customer (existing or new) and
 * a free-text description of the job, picks line items from the real price
 * book and creates one or more draft documents. Shared by the documents/new
 * form action and the internal AI assistant's create_estimate/invoice/proposal
 * tools so there's exactly one place that talks to Claude about pricing.
 *
 * Returns an array because a single request can describe multiple distinct,
 * mutually exclusive options (e.g. "Option A: heat pump" vs "Option B:
 * straight AC replacement") that each need their own separate good/better/best
 * pricing — merging them into one document would silently add both options'
 * costs together instead of letting the customer choose one.
 */
export async function generateDocumentForCustomer(
  input: GenerateDocumentInput
): Promise<GenerateDocumentResult[]> {
  if (!DOC_PREFIX[input.type]) throw new Error("Invalid document type");
  if (!input.rawRequest?.trim()) throw new Error("Describe the job before generating");

  const resolved = await resolveCustomerPropertyEquipment({
    customerId: input.customerId,
    customerName: input.customerName,
    phone: input.phone,
    email: input.email,
    smsConsent: input.smsConsent,
    propertyId: input.propertyId,
    address: input.address,
  });
  const customerId = resolved.customerId;
  const propertyId = resolved.propertyId;
  if (!customerId) throw new Error("Customer is required");

  const [{ data: customer }, propertyResult, priceBookRows] = await Promise.all([
    supabase.from("customers").select("*").eq("id", customerId).single(),
    propertyId
      ? supabase.from("properties").select("*").eq("id", propertyId).single()
      : Promise.resolve({ data: null }),
    fetchAllPriceBookItems(supabase, "category, name, tier, unit_price"),
  ]);
  const property = propertyResult.data;

  let equipment: { type: string; brand: string | null; model: string | null }[] = [];
  if (propertyId) {
    const { data } = await supabase
      .from("equipment")
      .select("type, brand, model")
      .eq("property_id", propertyId);
    equipment = data ?? [];
  }

  const priceBookText = formatPriceBookForPrompt(priceBookRows);

  const systemPrompt = `You are the AI estimating assistant for East Coast Mechanical (ECM), an HVAC & plumbing contractor in Plymouth, MA.

Select line items from the price book below to build a ${input.type}. Prices are fully installed (equipment + standard labor) unless the item is an hourly or per-unit add-on. Reference the exact price book name in "price_book_item_name" when a good match exists. If nothing matches well, leave price_book_item_name null, write a clear description, and set your own reasonable good/better/best prices, noting "[custom item]" in notes.

Some price book items show three tiered prices (G=Good B=Better X=Best); others show a single flat price ($X) because they're a specific real distributor SKU with one sell price, not a tiered choice — for those, use that same $X value for good, better, and best on that line item.

Set "category" to the price book category the item came from (or a sensible category for custom items).

Quantity should reflect what the request implies (number of zones, linear feet, units, etc). Use "EA" as the unit unless the item is naturally priced per linear foot ("LF"), per hour ("HR"), or per pound ("LB").

PRICE BOOK (2026, USD, G=Good B=Better X=Best, or $=flat price):
${priceBookText}

If the request clearly qualifies for a MassSave rebate (heat pumps, heat pump water heaters, R-32/R-454B refrigerant — never R-410A), set mass_save_eligible=true and describe the rebate amount/program in mass_save_note. Otherwise set mass_save_eligible=false and mass_save_note to null.

${input.photos?.length ? "The tech attached jobsite photos and/or plan documents — use them to identify equipment, dimensions, layout, and scope directly, and let them inform your line items alongside the text description below." : ""}

You return a list of "documents". Almost every job produces exactly ONE entry — its good/better/best line item prices already represent the normal tier choice (standard vs premium model of the SAME system). Only return MORE THAN ONE entry when the job explicitly describes two or more distinct, mutually exclusive options to choose between (e.g. "Option A: heat pump" vs "Option B: straight AC replacement", or "quote the repair and the full replacement separately"). In that case:
- Every entry must have a short, non-null "option_label" (e.g. "Option A: Heat Pump System") — when there's more than one document, ALL of them need a label, not just some.
- Each entry's line_items and good/better/best totals must cover ONLY that option's own equipment and costs.
- Never combine line items from different options into the same entry, and never let one option's costs add into another's total.
- Set option_label to null when there's only one document.`;

  const userMessage = `Generate a ${input.type} for this job.

Customer: ${customer?.name ?? "Unknown"}
${property ? `Property: ${property.address} (${property.property_type ?? "unspecified"})` : "No property on file."}
${
  equipment.length > 0
    ? `Existing equipment: ${equipment
        .map((e) => `${e.type}${e.brand ? ` (${e.brand}${e.model ? " " + e.model : ""})` : ""}`)
        .join(", ")}`
    : ""
}

Job request from the tech:
${input.rawRequest}`;

  const photoFiles = (input.photos ?? []).filter((f) => f && f.size > 0);
  const [fileBlocks, uploadedPhotos] = await Promise.all([
    photoFiles.length ? buildFileContentBlocks(photoFiles) : Promise.resolve([]),
    photoFiles.length ? uploadDocumentPhotos(photoFiles) : Promise.resolve([]),
  ]);

  const response = await claude.messages.parse({
    model: CLAUDE_MODEL,
    max_tokens: 8192,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: fileBlocks.length ? [...fileBlocks, { type: "text", text: userMessage }] : userMessage,
      },
    ],
    output_config: {
      format: zodOutputFormat(GeneratedDocSchema),
    },
  });

  const parsed = response.parsed_output;
  if (!parsed || parsed.documents.length === 0) {
    throw new Error("Claude did not return a parseable document. Try again.");
  }

  const results: GenerateDocumentResult[] = [];

  // Sequential, not Promise.all: nextDocNumber() counts existing rows of this
  // type, so concurrent calls could read the same count and collide on the
  // same doc_number before either insert lands.
  for (const doc of parsed.documents) {
    const totals = {
      good: sumTier(doc.line_items, "good"),
      better: sumTier(doc.line_items, "better"),
      best: sumTier(doc.line_items, "best"),
    };

    const docNumber = await nextDocNumber(input.type);

    const { data: document, error } = await supabase
      .from("documents")
      .insert({
        doc_number: docNumber,
        type: input.type,
        customer_id: customerId,
        property_id: propertyId,
        status: "draft",
        line_items: {
          items: doc.line_items,
          brand: doc.brand,
          mass_save_eligible: doc.mass_save_eligible,
          mass_save_note: doc.mass_save_note,
          totals,
          option_label: doc.option_label,
        },
        subtotal: totals.better,
        tax: 0,
        total: totals.better,
        ai_generated: true,
        raw_request: input.rawRequest,
        photos: uploadedPhotos,
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);

    results.push({ documentId: document.id, docNumber, optionLabel: doc.option_label, totals });
  }

  return results;
}
