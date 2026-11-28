import { NextResponse } from "next/server";
import { fieldBoardCaller } from "@/lib/bot-keys";
import { rundownState } from "@/lib/rundown";

export const dynamic = "force-dynamic";

/**
 * GET /api/rundown/state?since=ISO. Same bot-key auth as POST /api/rundown.
 * Returns this bot's open items and the ones finished since `since` (default 14 days),
 * so Grok stops repeating what Josh already finished.
 */
export async function GET(request: Request) {
  const caller = await fieldBoardCaller(request);
  if (!caller?.bot) {
    return NextResponse.json({ error: "Unauthorized. Use a bot key from /account." }, { status: 401 });
  }
  const sinceParam = new URL(request.url).searchParams.get("since");
  let since: string | null = null;
  if (sinceParam) {
    const when = new Date(sinceParam);
    if (Number.isNaN(when.getTime())) {
      return NextResponse.json({ error: "since must be an ISO date or date-time" }, { status: 400 });
    }
    since = when.toISOString();
  }
  const result = await rundownState(caller.bot, since);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result);
}
