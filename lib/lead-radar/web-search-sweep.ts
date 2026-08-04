import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { supabase } from "@/lib/supabase";
import { claude, CLAUDE_MODEL_BALANCED } from "@/lib/claude";
import { SERVICE_AREA_LABEL } from "./service-area";

const WebLeadSchema = z.object({
  title: z.string(),
  summary: z.string(),
  source_url: z.string().min(1),
  contact_name: z.string().nullable(),
  contact_info: z.string().nullable(),
  channel: z.enum(["reply_to_post", "email", "call"]),
  draft_message: z.string().min(1),
});

const WebSearchResultSchema = z.object({
  leads: z.array(WebLeadSchema),
});

const SYSTEM_PROMPT = `You are a lead-sourcing assistant for East Coast Mechanical (ECM), an HVAC & plumbing contractor serving ${SERVICE_AREA_LABEL}.

Search the public web for people who currently need HVAC or plumbing service, repair, or installation in ECM's service area — e.g. "no heat" / "AC not working" posts, people asking for HVAC installer recommendations, posts about needing a new furnace/AC/water heater/mini-split.

Hard rules:
- Only use genuinely public, indexable content you can actually search — Reddit threads, public forums, local news, publicly cached pages. Do NOT attempt to access, reference, or assume access to Facebook Groups, Nextdoor, Instagram, or any platform that requires logging into an account. If a source would require a login, skip it entirely.
- "source_url" must be a real URL that your search actually returned. Never fabricate or guess a URL. If you are not confident in a URL, omit that lead entirely.
- Draft a message appropriate to the channel: if this is a public post/thread, draft a short, genuine, non-spammy reply to post in that thread ("reply_to_post"). Only use "email" if a real, publicly-posted contact email was found. Only use "call" if just a business/homeowner name and area were found (draft a short call-script note instead of a message).
- Do not invent a phone number or email that doesn't appear in what you found.
- It is completely normal and expected to return an empty "leads" array on a quiet day — do not stretch or fabricate leads to have something to report, and never describe your own search process as if it were a lead. Every item in "leads" must correspond to one real, specific post you found, with a real URL to it.`;

export async function runWebSearchSweep(): Promise<{ inserted: number; errors: string[] }> {
  const errors: string[] = [];

  let parsed: z.infer<typeof WebSearchResultSchema> | null = null;
  try {
    const response = await claude.messages.parse({
      model: CLAUDE_MODEL_BALANCED,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content:
            "Search for current HVAC/plumbing service leads in the service area and report back any genuine public posts you find.",
        },
      ],
      tools: [
        {
          type: "web_search_20260209",
          name: "web_search",
          max_uses: 8,
          user_location: { type: "approximate", city: "Plymouth", region: "Massachusetts", country: "US" },
        },
      ],
      output_config: {
        format: zodOutputFormat(WebSearchResultSchema),
      },
    });
    parsed = response.parsed_output ?? null;
  } catch (err) {
    errors.push(err instanceof Error ? err.message : "Web search sweep failed");
    return { inserted: 0, errors };
  }

  if (!parsed) {
    errors.push("Claude did not return a parseable web search result");
    return { inserted: 0, errors };
  }

  const { data: existingLeads } = await supabase.from("leads").select("source_url").eq("source", "web_search");
  const alreadySeen = new Set((existingLeads ?? []).map((l) => l.source_url));

  let inserted = 0;
  for (const lead of parsed.leads) {
    // Guard against the model reporting on its own search process instead of a
    // genuine lead (e.g. an empty/placeholder source_url or draft) — don't
    // trust the schema alone to enforce this.
    if (!/^https?:\/\//.test(lead.source_url.trim())) continue;
    if (!lead.draft_message.trim()) continue;
    if (alreadySeen.has(lead.source_url)) continue;

    const { error } = await supabase.from("leads").insert({
      source: "web_search",
      status: "new",
      summary: lead.summary || lead.title,
      source_url: lead.source_url,
      contact_name: lead.contact_name,
      contact_info: lead.contact_info,
      channel: lead.channel,
      draft_message: lead.draft_message,
      auto_sendable: false,
    });
    if (error) {
      errors.push(`lead "${lead.title}": ${error.message}`);
      continue;
    }
    alreadySeen.add(lead.source_url);
    inserted++;
  }

  return { inserted, errors };
}
