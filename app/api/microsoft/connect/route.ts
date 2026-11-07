import { NextResponse } from "next/server";
import { getStaffRole } from "@/lib/require-role";
import { authorizeUrl, delegatedConfigured, OAUTH_COOKIE, pkcePair, randomState } from "@/lib/microsoft-delegated";

// Owner starts the Microsoft sign-in for OneNote. proxy.ts requires a staff
// sign-in on this path; the owner check is here. The state and PKCE verifier
// ride in a short-lived httpOnly cookie that only /api/microsoft reads.



export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  if ((await getStaffRole()) !== "owner") return NextResponse.redirect(`${origin}/account`, 302);
  if (!delegatedConfigured()) return NextResponse.redirect(`${origin}/account?onenote=not_configured`, 302);

  const state = randomState();
  const { verifier, challenge } = pkcePair();
  const redirectUri = `${origin}/api/microsoft/callback`;

  const res = NextResponse.redirect(authorizeUrl({ redirectUri, state, codeChallenge: challenge }), 302);
  res.cookies.set(OAUTH_COOKIE, `${state}.${verifier}`, {
    httpOnly: true,
    secure: true,
    sameSite: "lax", // sent on Microsoft's top-level redirect back
    path: "/api/microsoft",
    maxAge: 600,
  });
  return res;
}
