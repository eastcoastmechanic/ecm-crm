import { claude, CLAUDE_MODEL_BALANCED } from "@/lib/claude";
import { supabase } from "@/lib/supabase";
import { findCustomerByPhone } from "./customer-lookup";
import { buildReceptionistTools } from "./tools";
import { BUSINESS_HOURS, COMPANY_NAME } from "./config";

type TranscriptEntry = { role: "user" | "assistant"; content: string };

function formatHour(hour: number) {
  const period = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12} ${period}`;
}

function buildSystemPrompt(customerName: string | null) {
  const hours = `Monday through Friday, ${formatHour(BUSINESS_HOURS.startHour)} to ${formatHour(BUSINESS_HOURS.endHour)}`;
  const customerContext = customerName
    ? `This caller is a known customer: ${customerName}.`
    : `This caller is not a recognized customer yet. If they want to book a job, ask for their name before using create_job_request. Before booking, also ask: "Would you like text updates about your appointment? Message and data rates may apply, and you can opt out anytime." Only pass smsConsent: true to create_job_request if they clearly say yes — if they decline, are unsure, or you don't ask, leave it false. Either way, continue with the booking; declining texts never blocks it.`;

  return `You are the AI phone receptionist for ${COMPANY_NAME}, a home mechanical services company, answering a live phone call. Business hours: ${hours}.

${customerContext}

You can answer scheduling questions and use tools to check availability, look up the caller's jobs, and propose new bookings or reschedules. Any booking or reschedule you create is a REQUEST pending confirmation from the office — never tell the caller their appointment is confirmed. Say things like "I've requested that time for you, and someone from our team will confirm it shortly."

This is a live phone call, not a text message: keep replies short, natural, and conversational, like something a person would actually say out loud. Never use markdown, bullet points, numbered lists, or symbols like asterisks or hyphens — speak in plain sentences only. Speech-to-text can mishear things, so if a date, time, or address sounds unclear, read it back to confirm before booking. Do not invent prices, diagnoses, or availability you haven't checked with a tool.`;
}

export async function greetCaller(params: { callSid: string; fromPhone: string }): Promise<string> {
  const { callSid, fromPhone } = params;
  const matchedCustomer = await findCustomerByPhone(fromPhone);

  const greeting = matchedCustomer?.name
    ? `Thanks for calling ${COMPANY_NAME}, ${matchedCustomer.name.split(" ")[0]}! How can I help you today?`
    : `Thanks for calling ${COMPANY_NAME}! How can I help you today?`;

  await supabase.from("ai_conversations").insert({
    channel: "voice",
    phone_number: fromPhone,
    call_sid: callSid,
    customer_id: matchedCustomer?.id ?? null,
    transcript: [{ role: "assistant", content: greeting }],
  });

  return greeting;
}

export async function respondToCall(params: {
  callSid: string;
  fromPhone: string;
  speechResult: string;
}): Promise<string> {
  const { callSid, fromPhone, speechResult } = params;

  const matchedCustomer = await findCustomerByPhone(fromPhone);

  const { data: existing } = await supabase
    .from("ai_conversations")
    .select("id, transcript")
    .eq("call_sid", callSid)
    .maybeSingle();

  const transcript: TranscriptEntry[] = (existing?.transcript as TranscriptEntry[] | null) ?? [];
  transcript.push({ role: "user", content: speechResult });

  const tools = buildReceptionistTools({
    customerId: matchedCustomer?.id ?? null,
    phoneNumber: fromPhone,
    createdVia: "ai_voice",
  });

  const finalMessage = await claude.beta.messages.toolRunner({
    model: CLAUDE_MODEL_BALANCED,
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
      channel: "voice",
      phone_number: fromPhone,
      call_sid: callSid,
      customer_id: matchedCustomer?.id ?? null,
      transcript,
    });
  }

  return replyText || "Sorry, could you say that again?";
}
