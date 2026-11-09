"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { sendSMS } from "@/lib/sms";
import { canText } from "@/lib/sms-consent";
import { requireOffice } from "@/lib/require-role";

type TranscriptEntry = { role: "user" | "assistant"; content: string };

export type ReplyState = { error?: string; sent?: boolean } | null;

/** Text a reply on an SMS thread. Returns { error } (never throws) so the form keeps the typed text. */
export async function sendManualReply(_prev: ReplyState, formData: FormData): Promise<ReplyState> {
  try {
    await requireOffice();
  } catch {
    return { error: "Only the office or owner can text customers." };
  }
  const conversationId = formData.get("conversation_id") as string;
  const message = (formData.get("message") as string)?.trim();
  if (!message) return { error: "Type a message first." };

  const { data: conversation, error } = await supabase
    .from("ai_conversations")
    .select("channel, phone_number, transcript")
    .eq("id", conversationId)
    .single();
  if (error || !conversation) return { error: "Couldn't find this conversation. Refresh and try again." };
  if (conversation.channel !== "sms") return { error: "Manual reply only works on text threads." };
  if (!conversation.phone_number) return { error: "No phone number on this conversation." };

  let allowed: boolean;
  try {
    allowed = await canText(conversation.phone_number, { allowUnknown: true });
  } catch (err) {
    console.error("sendManualReply: consent check failed", err instanceof Error ? err.message : err);
    return { error: "Couldn't check text consent for this number. Nothing was sent, try again." };
  }
  if (!allowed) {
    return { error: "This number has opted out of texts (or has no SMS consent). Call or email instead." };
  }

  const sent = await sendSMS(conversation.phone_number, message);
  if (!sent.ok) return { error: `Text didn't send: ${sent.error ?? "unknown problem"}. Try again.` };

  const transcript = (conversation.transcript as TranscriptEntry[] | null) ?? [];
  transcript.push({ role: "assistant", content: message });

  const { error: updateError } = await supabase
    .from("ai_conversations")
    .update({ transcript, updated_at: new Date().toISOString() })
    .eq("id", conversationId);
  revalidatePath(`/conversations/${conversationId}`);
  if (updateError) {
    console.error("sendManualReply: transcript save failed", updateError.message);
    // The text already went out, so say so plainly; do not invite a second send.
    return { sent: true, error: "Text sent, but it couldn't be saved to this thread. Don't send it again." };
  }
  return { sent: true };
}
