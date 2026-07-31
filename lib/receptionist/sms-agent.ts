import { claude, CLAUDE_MODEL } from "@/lib/claude";
import { supabase } from "@/lib/supabase";
import { findCustomerByPhone } from "./customer-lookup";
import { buildReceptionistTools } from "./tools";
import { BUSINESS_HOURS, COMPANY_NAME } from "./config";

type TranscriptEntry = { role: "user" | "assistant"; content: string };

function buildSystemPrompt(customerName: string | null) {
  const hours = `Monday-Friday, ${BUSINESS_HOURS.startHour}:00-${BUSINESS_HOURS.endHour}:00`;
  const customerContext = customerName
    ? `This texter is a known customer: ${customerName}.`
    : `This texter is not a recognized customer yet. If they want to book a job, ask for their name before using create_job_request.`;

  return `You are the SMS receptionist for ${COMPANY_NAME}, a home mechanical services company. Business hours: ${hours}.

${customerContext}

You can answer scheduling questions and use tools to check availability, look up the caller's jobs, and propose new bookings or reschedules. Any booking or reschedule you create is a REQUEST pending confirmation from the office — never tell the caller their appointment is confirmed. Say things like "I've requested [time] for you — someone from our team will confirm shortly."

Keep replies short and friendly, like a real text message. Do not invent prices, diagnoses, or availability you haven't checked with a tool.`;
}

export async function respondToSms(params: { fromPhone: string; body: string }): Promise<string> {
  const { fromPhone, body } = params;

  const matchedCustomer = await findCustomerByPhone(fromPhone);

  const { data: existing } = await supabase
    .from("ai_conversations")
    .select("id, transcript")
    .eq("phone_number", fromPhone)
    .eq("channel", "sms")
    .eq("status", "open")
    .maybeSingle();

  const transcript: TranscriptEntry[] = (existing?.transcript as TranscriptEntry[] | null) ?? [];
  transcript.push({ role: "user", content: body });

  const tools = buildReceptionistTools({
    customerId: matchedCustomer?.id ?? null,
    phoneNumber: fromPhone,
  });

  const finalMessage = await claude.beta.messages.toolRunner({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system: buildSystemPrompt(matchedCustomer?.name ?? null),
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    tools,
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
      channel: "sms",
      phone_number: fromPhone,
      customer_id: matchedCustomer?.id ?? null,
      transcript,
    });
  }

  return replyText || "Thanks for your message — someone from our team will follow up shortly.";
}
