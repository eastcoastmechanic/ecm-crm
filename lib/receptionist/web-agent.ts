import { claude, CLAUDE_MODEL_BALANCED } from "@/lib/claude";
import { supabase } from "@/lib/supabase";
import { buildWebChatTools } from "./web-tools";
import { BUSINESS_HOURS, COMPANY_NAME } from "./config";

type TranscriptEntry = { role: "user" | "assistant"; content: string };

const MAX_TURNS = 60;

function buildSystemPrompt() {
  const hours = `Monday-Friday, ${BUSINESS_HOURS.startHour}:00-${BUSINESS_HOURS.endHour}:00`;

  return `You are the AI assistant on ${COMPANY_NAME}'s website, a home heating/cooling services company. Business hours for scheduling: ${hours}.

You're talking to an anonymous website visitor — you don't know who they are yet. You can answer questions about services (heating, cooling, ductless/mini-splits, ductwork, heat pumps, air quality, maintenance) and use tools to check real availability and file a booking request. Any booking you create is a REQUEST pending confirmation from the office — never tell the visitor their appointment is confirmed. Say things like "I've requested [time] — someone from our team will confirm shortly."

Before booking, get their name, phone number, and service address. Keep replies short and conversational. Do not invent prices, diagnoses, or availability you haven't checked with a tool. If asked about pricing, say a technician can quote it during the visit. For emergencies, tell them to call directly rather than booking through chat.`;
}

export async function respondToWebChat(params: {
  sessionId: string;
  message: string;
}): Promise<string> {
  const { sessionId, message } = params;

  const { data: existing } = await supabase
    .from("ai_conversations")
    .select("id, transcript")
    .eq("session_id", sessionId)
    .eq("channel", "web")
    .eq("status", "open")
    .maybeSingle();

  const transcript: TranscriptEntry[] = (existing?.transcript as TranscriptEntry[] | null) ?? [];

  if (transcript.length >= MAX_TURNS) {
    return "This chat has run long enough that I'd rather have a real person take it from here — please call us directly.";
  }

  transcript.push({ role: "user", content: message });

  const finalMessage = await claude.beta.messages.toolRunner({
    model: CLAUDE_MODEL_BALANCED,
    max_tokens: 1024,
    system: buildSystemPrompt(),
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    tools: buildWebChatTools(),
    messages: transcript.map((t) => ({ role: t.role, content: t.content })),
  });

  const replyText = finalMessage.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  transcript.push({ role: "assistant", content: replyText });

  if (existing) {
    await supabase
      .from("ai_conversations")
      .update({ transcript, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
  } else {
    await supabase.from("ai_conversations").insert({
      channel: "web",
      session_id: sessionId,
      transcript,
    });
  }

  return replyText || "Thanks for your message — someone from our team will follow up shortly.";
}
