import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { syncRundownPlanner } from "@/lib/rundown-planner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Hourly. Reads back cards Josh completed on the ECM Daily Rundown plan, and retries
// any card whose Planner write failed or didn't fit in the last push.
export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const summary = await syncRundownPlanner();
  return NextResponse.json({ ok: true, ...summary });
}
