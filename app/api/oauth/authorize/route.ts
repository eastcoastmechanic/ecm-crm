import { supabase } from "@/lib/supabase";
import { verifyInternalCredentials } from "@/lib/internal-auth";
import { generateOpaqueToken, AUTH_CODE_TTL_SECONDS } from "@/lib/oauth";

/**
 * Authorization endpoint (OAuth 2.1 + PKCE). This is the one piece of the
 * whole flow reachable by an unauthenticated stranger who finds the URL --
 * the login form here is the actual gate, backed by the same
 * INTERNAL_AUTH_USER/PASSWORD credential that already protects the rest of
 * the internal app (see lib/internal-auth.ts).
 *
 * redirect_uri is validated by exact string match against what the client
 * registered (app/api/oauth/register/route.ts) *before* it's ever used as a
 * redirect target -- prefix/wildcard matching here is exactly how this
 * class of endpoint turns into an open redirect. Once validated, later
 * errors (bad response_type, non-S256 challenge) *do* redirect back with
 * ?error=... per spec; a bad/unregistered client_id or redirect_uri never
 * does -- it's a local error page instead.
 */

type AuthRequest = {
  responseType: string | null;
  clientId: string;
  redirectUri: string;
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
  state: string | null;
};

function readAuthParams(params: URLSearchParams): AuthRequest {
  return {
    responseType: params.get("response_type"),
    clientId: params.get("client_id") ?? "",
    redirectUri: params.get("redirect_uri") ?? "",
    codeChallenge: params.get("code_challenge"),
    codeChallengeMethod: params.get("code_challenge_method"),
    state: params.get("state"),
  };
}

async function validateClientAndRedirect(
  clientId: string,
  redirectUri: string
): Promise<{ ok: true } | { ok: false; errorPage: Response }> {
  const notFound = () => ({
    ok: false as const,
    errorPage: new Response("Unknown client or redirect_uri. This connector needs to register again.", {
      status: 400,
      headers: { "Content-Type": "text/plain" },
    }),
  });

  if (!clientId || !redirectUri) return notFound();

  const { data: client } = await supabase
    .from("oauth_clients")
    .select("redirect_uris")
    .eq("client_id", clientId)
    .single();
  if (!client) return notFound();

  const registered = client.redirect_uris as string[];
  if (!registered.includes(redirectUri)) return notFound();

  return { ok: true };
}

function loginFormHtml(req: AuthRequest, errorMessage?: string) {
  const hidden = (name: string, value: string | null) =>
    value !== null ? `<input type="hidden" name="${name}" value="${escapeHtml(value)}" />` : "";

  return `<!doctype html>
<html>
<head><meta charset="utf-8" /><title>Sign in — East Coast Mechanical</title>
<style>
  body { font-family: system-ui, sans-serif; background: #10151a; color: #e7ecee; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  form { background: #182029; border: 1px solid #2c3841; border-radius: 8px; padding: 2rem; width: 100%; max-width: 320px; }
  h1 { font-size: 1.1rem; margin: 0 0 1.25rem; }
  label { display: block; font-size: 0.8rem; color: #93a2ac; margin-bottom: 0.25rem; }
  input[type="text"], input[type="password"] { width: 100%; box-sizing: border-box; padding: 0.5rem; margin-bottom: 1rem; border-radius: 4px; border: 1px solid #2c3841; background: #10151a; color: #e7ecee; }
  button { width: 100%; padding: 0.6rem; border-radius: 4px; border: none; background: #a8582a; color: white; font-weight: 600; cursor: pointer; }
  .error { color: #e88b7e; font-size: 0.85rem; margin-bottom: 1rem; }
</style>
</head>
<body>
  <form method="POST">
    <h1>Sign in to connect Claude</h1>
    ${errorMessage ? `<div class="error">${escapeHtml(errorMessage)}</div>` : ""}
    <label>Username</label>
    <input type="text" name="username" autocomplete="username" required />
    <label>Password</label>
    <input type="password" name="password" autocomplete="current-password" required />
    ${hidden("response_type", req.responseType)}
    ${hidden("client_id", req.clientId)}
    ${hidden("redirect_uri", req.redirectUri)}
    ${hidden("code_challenge", req.codeChallenge)}
    ${hidden("code_challenge_method", req.codeChallengeMethod)}
    ${hidden("state", req.state)}
    <button type="submit">Sign in</button>
  </form>
</body>
</html>`;
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function htmlResponse(html: string, status = 200) {
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "DENY" },
  });
}

function redirectWithError(redirectUri: string, error: string, state: string | null) {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  if (state !== null) url.searchParams.set("state", state);
  return Response.redirect(url.toString(), 302);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const req = readAuthParams(url.searchParams);

  const validation = await validateClientAndRedirect(req.clientId, req.redirectUri);
  if (!validation.ok) return validation.errorPage;

  if (req.responseType !== "code") return redirectWithError(req.redirectUri, "unsupported_response_type", req.state);
  if (!req.codeChallenge || req.codeChallengeMethod !== "S256") {
    return redirectWithError(req.redirectUri, "invalid_request", req.state);
  }

  return htmlResponse(loginFormHtml(req));
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const req: AuthRequest = {
    responseType: (formData.get("response_type") as string) || null,
    clientId: (formData.get("client_id") as string) || "",
    redirectUri: (formData.get("redirect_uri") as string) || "",
    codeChallenge: (formData.get("code_challenge") as string) || null,
    codeChallengeMethod: (formData.get("code_challenge_method") as string) || null,
    state: (formData.get("state") as string) || null,
  };

  // Untrusted input regardless of a prior GET -- re-validate from scratch.
  const validation = await validateClientAndRedirect(req.clientId, req.redirectUri);
  if (!validation.ok) return validation.errorPage;

  if (req.responseType !== "code") return redirectWithError(req.redirectUri, "unsupported_response_type", req.state);
  if (!req.codeChallenge || req.codeChallengeMethod !== "S256") {
    return redirectWithError(req.redirectUri, "invalid_request", req.state);
  }

  const username = (formData.get("username") as string) || "";
  const password = (formData.get("password") as string) || "";

  if (!verifyInternalCredentials(username, password)) {
    // Never redirect on a bad password -- retry locally rather than
    // signaling anything to redirect_uri before identity is proven.
    return htmlResponse(loginFormHtml(req, "Incorrect username or password."), 401);
  }

  const code = generateOpaqueToken();
  const { error } = await supabase.from("oauth_authorization_codes").insert({
    code,
    client_id: req.clientId,
    redirect_uri: req.redirectUri,
    code_challenge: req.codeChallenge,
    code_challenge_method: req.codeChallengeMethod,
    expires_at: new Date(Date.now() + AUTH_CODE_TTL_SECONDS * 1000).toISOString(),
  });
  if (error) return htmlResponse(loginFormHtml(req, "Something went wrong. Try again."), 500);

  const redirectUrl = new URL(req.redirectUri);
  redirectUrl.searchParams.set("code", code);
  if (req.state !== null) redirectUrl.searchParams.set("state", req.state);
  return Response.redirect(redirectUrl.toString(), 302);
}
