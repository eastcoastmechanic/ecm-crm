import { NextResponse, type NextRequest } from "next/server";
import { getStaffRole } from "@/lib/require-role";
import { getMyStaffId } from "@/lib/job-access";
import { safeEqual } from "@/lib/bearer-auth";
import { completeSignIn, OAUTH_COOKIE } from "@/lib/microsoft-delegated";

// Microsoft sends the owner back here after the OneNote sign-in. Checks the
// state against the cookie set by /api/microsoft/connect, trades the code for
// tokens, and stores the refresh token encrypted. Never echoes tokens.

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const origin = url.origin;
  const back = (result: string) => {
    const res = NextResponse.redirect(`${origin}/account?onenote=${encodeURIComponent(result)}`, 302);
    res.cookies.set(OAUTH_COOKIE, "", { path: "/api/microsoft", maxAge: 0 });
    return res;
  };

  if ((await getStaffRole()) !== "owner") return back("not_allowed");

  const [cookieState, verifier] = (request.cookies.get(OAUTH_COOKIE)?.value ?? "").split(".");
  const state = url.searchParams.get("state") ?? "";
  if (!cookieState || !verifier || !state || !safeEqual(state, cookieState)) return back("expired");

  const msError = url.searchParams.get("error");
  if (msError) return back(msError === "access_denied" ? "cancelled" : msError.slice(0, 60));

  const code = url.searchParams.get("code");
  if (!code) return back("no_code");

  const result = await completeSignIn({
    code,
    redirectUri: `${origin}/api/microsoft/callback`,
    codeVerifier: verifier,
    staffId: await getMyStaffId(),
  });
  return back(result.ok ? "connected" : result.error.slice(0, 60));
}
