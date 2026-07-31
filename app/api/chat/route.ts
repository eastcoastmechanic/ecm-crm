import { NextResponse } from "next/server";
import { respondToWebChat } from "@/lib/receptionist/web-agent";
import { isRateLimited } from "@/lib/rate-limit";

const MAX_MESSAGE_LENGTH = 2000;

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many messages. Please wait a few minutes and try again." },
      { status: 429 }
    );
  }

  const body = await request.json().catch(() => null);
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";

  if (!sessionId) {
    return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
  }
  if (!message || message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: "Message must be between 1 and 2000 characters" }, { status: 400 });
  }

  try {
    const reply = await respondToWebChat({ sessionId, message });
    return NextResponse.json({ reply });
  } catch (err) {
    console.error("Chat error:", err);
    return NextResponse.json(
      { error: "Something went wrong. Please call us directly." },
      { status: 500 }
    );
  }
}
