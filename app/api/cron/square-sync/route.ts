import { cronAuthorized } from "@/lib/cron-auth";
import { NextResponse } from "next/server";
import { syncSquarePayments } from "@/lib/square-sync";

export const maxDuration = 60;

export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncSquarePayments();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Square sync failed" },
      { status: 500 }
    );
  }
}
