"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { supabase } from "@/lib/supabase";
import { claude, CLAUDE_MODEL } from "@/lib/claude";
import { formatPriceBookForPrompt } from "@/lib/price-book";

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

const GeneratedDocSchema = z.object({
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

function sumTier(
  items: z.infer<typeof LineItemSchema>[],
  tier: "good" | "better" | "best"
) {
  const total = items.reduce((sum, item) => {
    const price = item[tier];
    return price === null ? sum : sum + price * item.qty;
  }, 0);
  return Math.round(total * 100) / 100;
}

export async function generateDocument(formData: FormData) {
  const customer_id = formData.get("customer_id") as string;
  const property_id = (formData.get("property_id") as string) || null;
  const type = formData.get("type") as string;
  const raw_request = (formData.get("raw_request") as string)?.trim();

  if (!customer_id) throw new Error("Customer is required");
  if (!type || !DOC_PREFIX[type]) throw new Error("Document type is required");
  if (!raw_request) throw new Error("Describe the job before generating");

  const [{ data: customer }, propertyResult, { data: priceBookRows }] = await Promise.all([
    supabase.from("customers").select("*").eq("id", customer_id).single(),
    property_id
      ? supabase.from("properties").select("*").eq("id", property_id).single()
      : Promise.resolve({ data: null }),
    supabase.from("price_book_items").select("category, name, tier, unit_price"),
  ]);
  const property = propertyResult.data;

  let equipment: { type: string; brand: string | null; model: string | null }[] = [];
  if (property_id) {
    const { data } = await supabase
      .from("equipment")
      .select("type, brand, model")
      .eq("property_id", property_id);
    equipment = data ?? [];
  }

  const priceBookText = formatPriceBookForPrompt(priceBookRows ?? []);

  const systemPrompt = `You are the AI estimating assistant for East Coast Mechanical (ECM), an HVAC & plumbing contractor in Plymouth, MA.

Select line items from the price book below to build a ${type}. Prices are fully installed (equipment + standard labor) unless the item is an hourly or per-unit add-on. Reference the exact price book name in "price_book_item_name" when a good match exists. If nothing matches well, leave price_book_item_name null, write a clear description, and set your own reasonable good/better/best prices, noting "[custom item]" in notes.

Set "category" to the price book category the item came from (or a sensible category for custom items).

Quantity should reflect what the request implies (number of zones, linear feet, units, etc). Use "EA" as the unit unless the item is naturally priced per linear foot ("LF"), per hour ("HR"), or per pound ("LB").

PRICE BOOK (2026, USD, G=Good B=Better X=Best):
${priceBookText}

If the request clearly qualifies for a MassSave rebate (heat pumps, heat pump water heaters, R-32/R-454B refrigerant — never R-410A), set mass_save_eligible=true and describe the rebate amount/program in mass_save_note. Otherwise set mass_save_eligible=false and mass_save_note to null.`;

  const userMessage = `Generate a ${type} for this job.

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
${raw_request}`;

  const response = await claude.messages.parse({
    model: CLAUDE_MODEL,
    max_tokens: 8192,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    output_config: {
      format: zodOutputFormat(GeneratedDocSchema),
    },
  });

  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error("Claude did not return a parseable document. Try again.");
  }

  const totals = {
    good: sumTier(parsed.line_items, "good"),
    better: sumTier(parsed.line_items, "better"),
    best: sumTier(parsed.line_items, "best"),
  };

  const doc_number = await nextDocNumber(type);

  const { data: document, error } = await supabase
    .from("documents")
    .insert({
      doc_number,
      type,
      customer_id,
      property_id,
      status: "draft",
      line_items: {
        items: parsed.line_items,
        brand: parsed.brand,
        mass_save_eligible: parsed.mass_save_eligible,
        mass_save_note: parsed.mass_save_note,
        totals,
      },
      subtotal: totals.better,
      tax: 0,
      total: totals.better,
      ai_generated: true,
      raw_request,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  revalidatePath("/documents");
  redirect(`/documents/${document.id}`);
}
