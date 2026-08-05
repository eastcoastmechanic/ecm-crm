import { NextResponse } from "next/server";
import { respondToInternalChat, type ChatMessage } from "@/lib/internal-assistant/agent";
import { isRateLimited } from "@/lib/rate-limit";

const MAX_MESSAGE_LENGTH = 2000;
const MAX_TURNS = 60;

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.COPILOT_API_KEY}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (isRateLimited(ip, 60)) {
    return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);

  const command = typeof body?.command === "string" ? body.command : undefined;
  const messages: ChatMessage[] = command
    ? [{ role: "user", content: command }]
    : (body?.messages as ChatMessage[] | undefined) ?? [];

  if (messages.length === 0) {
    return NextResponse.json({ error: "Missing command" }, { status: 400 });
  }
  if (messages.length > MAX_TURNS) {
    return NextResponse.json({ error: "Conversation is too long — start a new one." }, { status: 400 });
  }
  const last = messages[messages.length - 1];
  if (!last?.content || last.content.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: "Message must be between 1 and 2000 characters" }, { status: 400 });
  }

  try {
    const reply = await respondToInternalChat(messages, { fast: true });
    return NextResponse.json({ reply });
  } catch (err) {
    console.error("Copilot assistant error:", err);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
