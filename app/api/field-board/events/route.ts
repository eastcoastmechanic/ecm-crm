import { NextResponse } from "next/server";
import { ingestFieldBoardEvent, type FieldBoardEventBody } from "@/lib/field-board";
import { fieldBoardCaller } from "@/lib/bot-keys";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const caller = await fieldBoardCaller(request);
  if (!caller) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as FieldBoardEventBody | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // A bot's own key decides its name; the `source` it sends is ignored.
  const result = await ingestFieldBoardEvent(caller.bot ? { ...body, source: caller.bot } : body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}
