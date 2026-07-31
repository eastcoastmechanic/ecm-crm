import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { supabase } from "@/lib/supabase";
import { claude, CLAUDE_MODEL } from "@/lib/claude";
import { EQUIPMENT_LIFESPAN_REFERENCE } from "@/lib/equipment-lifespan-reference";

const AgingItemSchema = z.object({
  in_replacement_window: z.boolean(),
  summary: z.string(),
  draft_message: z.string().nullable(),
});

const AgingResultSchema = z.object({
  items: z.array(AgingItemSchema),
});

const SYSTEM_PROMPT = `You are a proactive-maintenance assistant for East Coast Mechanical (ECM), an HVAC & plumbing contractor. You'll be given a list of equipment with type and age. Using the typical service life reference below, decide for each item whether it's entering its replacement window (age approaching or past the low end of its typical range).

${EQUIPMENT_LIFESPAN_REFERENCE}

For each item, in the same order given:
- "in_replacement_window": true only if the equipment is genuinely worth flagging to the customer now (age at or beyond roughly 80% of the low end of its typical range). Most equipment given to you will already have been pre-filtered to plausible candidates, but use your judgment — don't flag something clearly still young for its type.
- "summary": one sentence on why (or why not).
- "draft_message": only when in_replacement_window is true — a short, friendly, non-alarmist message to the customer noting their equipment's age and offering a checkup/replacement quote. Null otherwise.
Return exactly one item per piece of equipment, in the same order listed.`;

type EquipmentRow = {
  id: string;
  type: string;
  brand: string | null;
  model: string | null;
  install_date: string | null;
  properties: {
    address: string | null;
    customers: {
      id: string;
      name: string | null;
      phone: string | null;
      email: string | null;
      sms_consent: boolean | null;
    } | null;
  } | null;
};

function ageYears(installDate: string | null): number | null {
  if (!installDate) return null;
  return (Date.now() - new Date(installDate).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
}

export async function runAgingEquipmentSweep(): Promise<{ inserted: number; errors: string[] }> {
  const errors: string[] = [];

  const { data: rows, error: fetchError } = await supabase
    .from("equipment")
    .select("id, type, brand, model, install_date, properties(address, customers(id, name, phone, email, sms_consent))")
    .not("install_date", "is", null)
    .returns<EquipmentRow[]>();

  if (fetchError) {
    errors.push(fetchError.message);
    return { inserted: 0, errors };
  }

  const { data: existingLeads } = await supabase
    .from("leads")
    .select("equipment_id")
    .eq("source", "aging_equipment");
  const alreadyLeaded = new Set((existingLeads ?? []).map((l) => l.equipment_id));

  const candidates = (rows ?? []).filter((row) => {
    if (alreadyLeaded.has(row.id)) return false;
    if (!row.properties?.customers) return false;
    const age = ageYears(row.install_date);
    return age !== null && age >= 7;
  });

  if (candidates.length === 0) {
    return { inserted: 0, errors };
  }

  const userMessage = candidates
    .map((row, i) => {
      const age = ageYears(row.install_date);
      return `${i + 1}. ${row.type}${row.brand ? ` — ${row.brand}` : ""}${row.model ? ` ${row.model}` : ""}, age ${age?.toFixed(1)} years`;
    })
    .join("\n");

  let parsed: z.infer<typeof AgingResultSchema> | null = null;
  try {
    const response = await claude.messages.parse({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
      output_config: {
        format: zodOutputFormat(AgingResultSchema),
      },
    });
    parsed = response.parsed_output ?? null;
  } catch (err) {
    errors.push(err instanceof Error ? err.message : "Aging equipment sweep failed");
    return { inserted: 0, errors };
  }

  if (!parsed || parsed.items.length !== candidates.length) {
    errors.push("Claude returned a mismatched or unparseable aging-equipment result");
    return { inserted: 0, errors };
  }

  let inserted = 0;
  for (let i = 0; i < candidates.length; i++) {
    const item = parsed.items[i];
    if (!item.in_replacement_window || !item.draft_message) continue;

    const row = candidates[i];
    const customer = row.properties!.customers!;

    let channel: "sms" | "email" | "none" = "none";
    let autoSendable = false;
    if (customer.phone && customer.sms_consent) {
      channel = "sms";
      autoSendable = true;
    } else if (customer.email) {
      channel = "email";
      autoSendable = true;
    }

    const { error } = await supabase.from("leads").insert({
      source: "aging_equipment",
      status: "new",
      customer_id: customer.id,
      equipment_id: row.id,
      phone_number: channel === "sms" ? customer.phone : null,
      contact_name: customer.name,
      summary: item.summary,
      channel,
      draft_message: item.draft_message,
      auto_sendable: autoSendable,
    });
    if (error) {
      errors.push(`equipment ${row.id}: ${error.message}`);
      continue;
    }
    inserted++;
  }

  return { inserted, errors };
}
