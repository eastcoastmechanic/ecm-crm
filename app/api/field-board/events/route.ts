import { NextResponse } from "next/server";
import {
  fieldBoardAuthorized,
  ingestFieldBoardEvent,
  type FieldBoardEventBody,
} from "@/lib/field-board";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!fieldBoardAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as FieldBoardEventBody | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = await ingestFieldBoardEvent(body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}
