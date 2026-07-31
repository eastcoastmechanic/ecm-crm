import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { supabase } from "@/lib/supabase";
import { claude, CLAUDE_MODEL } from "@/lib/claude";

const FollowUpSchema = z.object({
  summary: z.string(),
  draft_message: z.string(),
});

const SYSTEM_PROMPT = `You are a friendly follow-up assistant for East Coast Mechanical (ECM), an HVAC & plumbing contractor. Someone previously texted or called ECM's business line but the conversation never turned into a scheduled job or a saved customer record. Write:
- "summary": one sentence on what they were asking about, based on the transcript.
- "draft_message": a short, warm, low-pressure SMS-style follow-up checking whether they still need help. Don't be presumptuous about details the transcript didn't actually cover.`;

export async function runMissedContactSweep(): Promise<{ inserted: number; errors: string[] }> {
  const errors: string[] = [];

  const { data: conversations, error: fetchError } = await supabase
    .from("ai_conversations")
    .select("id, phone_number, channel, transcript, created_at")
    .is("customer_id", null);

  if (fetchError) {
    errors.push(fetchError.message);
    return { inserted: 0, errors };
  }

  const { data: existingLeads } = await supabase
    .from("leads")
    .select("phone_number")
    .eq("source", "missed_contact");
  const alreadyLeaded = new Set((existingLeads ?? []).map((l) => l.phone_number));

  const candidates = (conversations ?? []).filter(
    (c) => c.phone_number && !alreadyLeaded.has(c.phone_number)
  );

  let inserted = 0;
  for (const convo of candidates) {
    let parsed: z.infer<typeof FollowUpSchema> | null = null;
    try {
      const response = await claude.messages.parse({
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Channel: ${convo.channel}\nTranscript:\n${JSON.stringify(convo.transcript)}`,
          },
        ],
        output_config: {
          format: zodOutputFormat(FollowUpSchema),
        },
      });
      parsed = response.parsed_output ?? null;
    } catch (err) {
      errors.push(`conversation ${convo.id}: ${err instanceof Error ? err.message : "Claude call failed"}`);
      continue;
    }

    if (!parsed) {
      errors.push(`conversation ${convo.id}: no parseable output`);
      continue;
    }

    const { error } = await supabase.from("leads").insert({
      source: "missed_contact",
      status: "new",
      phone_number: convo.phone_number,
      summary: parsed.summary,
      channel: "sms",
      draft_message: parsed.draft_message,
      auto_sendable: false,
    });
    if (error) {
      errors.push(`conversation ${convo.id}: ${error.message}`);
      continue;
    }
    alreadyLeaded.add(convo.phone_number);
    inserted++;
  }

  return { inserted, errors };
}
