import { NextResponse } from "next/server";
import { respondToInternalChat, type ChatMessage } from "@/lib/internal-assistant/agent";
import { isRateLimited } from "@/lib/rate-limit";

const MAX_MESSAGE_LENGTH = 2000;
const MAX_TURNS = 60;

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (isRateLimited(ip, 60)) {
    return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const messages = body?.messages as ChatMessage[] | undefined;

  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "Missing messages" }, { status: 400 });
  }
  if (messages.length > MAX_TURNS) {
    return NextResponse.json({ error: "Conversation is too long — start a new chat." }, { status: 400 });
  }
  const last = messages[messages.length - 1];
  if (last?.content && last.content.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: "Message must be under 2000 characters" }, { status: 400 });
  }
  if (!last?.content && !last?.attachments?.length) {
    return NextResponse.json({ error: "Message is empty" }, { status: 400 });
  }
  if (last?.attachments && last.attachments.length > 3) {
    return NextResponse.json({ error: "Attach at most 3 files at a time" }, { status: 400 });
  }

  // Hands-free callers (glasses, voice) can't sit through a 70-90s document
  // generation with nothing to listen to, so they opt into the same fast path
  // Teams/Copilot uses: reply immediately, generate in the background. The web
  // chat widget leaves this off and waits, since it can show a spinner.
  const fast = body?.fast === true;

  try {
    const reply = await respondToInternalChat(messages, { fast });
    return NextResponse.json({ reply });
  } catch (err) {
    console.error("Internal chat error:", err);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
