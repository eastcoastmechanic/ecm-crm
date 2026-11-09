import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { getStaffRole } from "@/lib/require-role";
import { applyOfflineAction } from "@/lib/offline-sync";
import { parseSyncRequest } from "@/lib/offline-sync-rules";

// The truck screen's queue sends each tap here (On my way, I'm here, Finish, job note),
// right away with signal or later when signal comes back. A route, not a server action,
// because a phone can hold a tap across a deploy and server action ids change every deploy.
// proxy.ts signs the caller in (/field-board/*) and sets the role; techs are allowed here.
//
// Answers: 200 { ok: true } done (or already done), 200 { ok: false, error } refused (shown
// on the card), 503 try again later, 401 signed out.

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  // Only our own page posts here: JSON from the same origin.
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ ok: false, error: "Not allowed." }, { status: 403 });
  }
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }
  if (!(await getStaffRole())) {
    return NextResponse.json({ ok: false, error: "Sign in again to send." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }
  const parsed = parseSyncRequest(body);
  if ("error" in parsed) return NextResponse.json({ ok: false, error: parsed.error });

  const result = await applyOfflineAction(parsed);
  if (!result.ok && result.retry) return NextResponse.json(result, { status: 503 });
  if (result.ok && !result.already) {
    revalidatePath("/field-board");
    revalidatePath("/jobs");
  }
  return NextResponse.json(result);
}
