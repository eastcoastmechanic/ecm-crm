import { NextResponse } from "next/server";
import { getCopilotActionTools } from "@/lib/copilot-actions";

/**
 * The endpoint Copilot Studio's custom connector calls, one action per
 * request. Auth is a dedicated API key (not CRON_SECRET or the Graph
 * connector's cert) -- a different trust boundary deserves its own
 * credential, one Copilot Studio can hold directly as its connector's API
 * key.
 */
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const apiKey = request.headers.get("x-api-key");
  if (!apiKey || apiKey !== process.env.COPILOT_ACTIONS_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { action } = await params;
  const tool = getCopilotActionTools().find((t) => t.name === action);
  if (!tool) {
    return NextResponse.json({ error: `Unknown action "${action}"` }, { status: 404 });
  }

  let body: unknown = {};
  const rawBody = await request.text();
  if (rawBody) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
    }
  }

  let input;
  try {
    input = tool.parse(body);
  } catch (err) {
    return NextResponse.json(
      { error: `Invalid input: ${err instanceof Error ? err.message : "unknown validation error"}` },
      { status: 400 }
    );
  }

  try {
    const result = await tool.run(input);
    return NextResponse.json({ result });
  } catch (err) {
    return NextResponse.json(
      { error: `Action failed: ${err instanceof Error ? err.message : "unknown error"}` },
      { status: 500 }
    );
  }
}
