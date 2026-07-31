import { notFound } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { sendManualReply } from "./actions";
import SubmitButton from "../../SubmitButton";
import { buttonClass, headingClass, inputClass, subTextClass } from "../../ui";

export const dynamic = "force-dynamic";

type TranscriptEntry = { role: "user" | "assistant"; content: string };

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: conversation, error } = await supabase
    .from("ai_conversations")
    .select("*, customers(name)")
    .eq("id", id)
    .single();

  if (error || !conversation) notFound();

  const transcript = (conversation.transcript as TranscriptEntry[] | null) ?? [];
  const customers = conversation.customers as unknown as { name: string | null }[] | null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className={headingClass}>
          {customers?.[0]?.name ?? conversation.phone_number ?? "Conversation"}
        </h1>
        <p className={subTextClass}>
          {conversation.channel} · {conversation.status}
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-white/8 bg-white/3 p-4">
        {transcript.length === 0 && <p className={subTextClass}>No messages yet.</p>}
        {transcript.map((entry, i) => (
          <div
            key={i}
            className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
              entry.role === "assistant"
                ? "self-end bg-accent/20 text-white"
                : "self-start bg-white/8 text-white"
            }`}
          >
            {entry.content}
          </div>
        ))}
      </div>

      {conversation.channel === "sms" && conversation.phone_number && (
        <form action={sendManualReply} className="flex items-center gap-2">
          <input type="hidden" name="conversation_id" value={conversation.id} />
          <input
            name="message"
            placeholder="Send a text reply…"
            required
            className={`${inputClass} flex-1`}
          />
          <SubmitButton className={buttonClass} pendingText="Sending…">
            Send
          </SubmitButton>
        </form>
      )}

      <Link href="/conversations" className={subTextClass}>
        &larr; Back to conversations
      </Link>
    </div>
  );
}
