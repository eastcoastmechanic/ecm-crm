import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { closeStaleTime } from "@/lib/time-clock";

export const dynamic = "force-dynamic";

// Daily. Closes a shift or job timer someone forgot to stop, and flags it for the office.
export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const closed = await closeStaleTime();
  return NextResponse.json({ ok: true, ...closed });
}
