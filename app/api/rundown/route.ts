import { NextResponse, after } from "next/server";
import { fieldBoardCaller } from "@/lib/bot-keys";
import { ingestRundown } from "@/lib/rundown";
import { parseRundownBody } from "@/lib/rundown-rules";
import { syncRundownPlanner } from "@/lib/rundown-planner";

export const dynamic = "force-dynamic";
// The Planner push runs after the response (after()), inside this limit.
export const maxDuration = 60;

/**
 * Grok's nightly rundown as JSON (contract: docs/ecm/grok-rundown-api.md).
 * Auth: a bot key from /account (Authorization: Bearer ecmbot_...). The bot's name
 * comes from its key. Planner is updated after the response; a Planner problem never
 * fails this call (the hourly /api/cron/rundown-sync retries).
 */
export async function POST(request: Request) {
  const caller = await fieldBoardCaller(request);
  if (!caller?.bot) {
    return NextResponse.json({ error: "Unauthorized. Use a bot key from /account." }, { status: 401 });
  }

  const raw = await request.json().catch(() => null);
  if (!raw) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const parsed = parseRundownBody(raw);
  if (!parsed.ok) return NextResponse.json({ error: "Invalid rundown", details: parsed.errors }, { status: 400 });

  const result = await ingestRundown(caller.bot, parsed.body, raw);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  after(async () => {
    // A long first run can be more than one batch: keep going while there's time.
    const started = Date.now();
    for (let round = 0; round < 4; round++) {
      const summary = await syncRundownPlanner();
      if (!summary.remaining || summary.failed > 0 || Date.now() - started > 30_000) break;
    }
  });
  return NextResponse.json({ ...result, planner: "queued" });
}
