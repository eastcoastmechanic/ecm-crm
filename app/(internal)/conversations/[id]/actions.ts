"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { sendSMS } from "@/lib/sms";
import { canText } from "@/lib/sms-consent";
import { requireOffice } from "@/lib/require-role";

type TranscriptEntry = { role: "user" | "assistant"; content: string };

export async function sendManualReply(formData: FormData) {
  await requireOffice();
  const conversationId = formData.get("conversation_id") as string;
  const message = (formData.get("message") as string)?.trim();
  if (!message) throw new Error("Message can't be empty");

  const { data: conversation, error } = await supabase
    .from("ai_conversations")
    .select("channel, phone_number, transcript")
    .eq("id", conversationId)
    .single();
  if (error || !conversation) throw new Error("Conversation not found");
  if (conversation.channel !== "sms") throw new Error("Manual reply is only available for text threads");
  if (!conversation.phone_number) throw new Error("No phone number on this conversation");

  if (!(await canText(conversation.phone_number, { allowUnknown: true }))) {
    throw new Error("This number has opted out of texts (or has no SMS consent). Call or email instead.");
  }

  const sent = await sendSMS(conversation.phone_number, message);
  if (!sent.ok) throw new Error(sent.error ?? "Text failed to send");

  const transcript = (conversation.transcript as TranscriptEntry[] | null) ?? [];
  transcript.push({ role: "assistant", content: message });

  const { error: updateError } = await supabase
    .from("ai_conversations")
    .update({ transcript, updated_at: new Date().toISOString() })
    .eq("id", conversationId);
  if (updateError) throw new Error(updateError.message);

  revalidatePath(`/conversations/${conversationId}`);
}
