import { claude, CLAUDE_MODEL } from "@/lib/claude";
import { buildInternalTools } from "./tools";

export type ChatMessage = { role: "user" | "assistant"; content: string };

const SYSTEM_PROMPT = `You are the internal AI assistant inside East Coast Mechanical's CRM, talking directly to the owner/staff (not a customer). You can:
- Add a new customer
- Look up an existing customer
- Generate a real estimate, invoice, or proposal (pulling from the actual price book)
- Add, list, and complete tasks/to-dos

Unlike a customer-facing assistant, when you take an action here it's real and final immediately — there's no "pending confirmation" step. Just do what's asked and clearly state what you did (e.g. "Added customer Jane Doe" or "Created EST-1042 for Jane Doe — Better $2,400"). If a required detail is missing (like which customer, for a new document), ask for it rather than guessing. Keep replies brief and concrete.`;

export async function respondToInternalChat(messages: ChatMessage[]): Promise<string> {
  const finalMessage = await claude.beta.messages.toolRunner({
    model: CLAUDE_MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    tools: buildInternalTools(),
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });

  return finalMessage.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}
