import { randomUUID } from "crypto";
import { supabase } from "@/lib/supabase";
import { generateOpaqueToken, hashToken, verifyPkce, ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS } from "@/lib/oauth";

/**
 * Token endpoint. Public/unauthenticated at the HTTP layer -- security
 * comes entirely from possession of a valid code (+ matching PKCE verifier)
 * or a valid, unrevoked refresh token.
 */

function tokenError(error: string, status = 400) {
  return Response.json({ error, error_description: error }, { status });
}

async function issueTokenPair(clientId: string, familyId: string) {
  const now = Date.now();
  const accessToken = generateOpaqueToken();
  const refreshToken = generateOpaqueToken();

  const { error } = await supabase.from("oauth_tokens").insert([
    {
      token_hash: hashToken(accessToken),
      token_type: "access",
      client_id: clientId,
      family_id: familyId,
      expires_at: new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
    },
    {
      token_hash: hashToken(refreshToken),
      token_type: "refresh",
      client_id: clientId,
      family_id: familyId,
      expires_at: new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString(),
    },
  ]);
  if (error) throw new Error(error.message);

  return Response.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
  });
}

async function handleAuthorizationCode(form: FormData) {
  const code = (form.get("code") as string) || "";
  const redirectUri = (form.get("redirect_uri") as string) || "";
  const clientId = (form.get("client_id") as string) || "";
  const codeVerifier = (form.get("code_verifier") as string) || "";
  if (!code || !redirectUri || !clientId || !codeVerifier) return tokenError("invalid_request");

  // Atomic single-use claim -- a code can never be redeemed twice even
  // under concurrent requests, unlike a select-then-update.
  const { data: claimed } = await supabase
    .from("oauth_authorization_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("code", code)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("client_id, redirect_uri, code_challenge, code_challenge_method")
    .single();

  if (!claimed) return tokenError("invalid_grant");
  // The code is burned regardless of what happens past this point — a
  // failed exchange attempt is exactly what single-use codes exist to stop.
  if (claimed.client_id !== clientId || claimed.redirect_uri !== redirectUri) return tokenError("invalid_grant");
  if (claimed.code_challenge_method !== "S256") return tokenError("invalid_grant");
  if (!verifyPkce(codeVerifier, claimed.code_challenge)) return tokenError("invalid_grant");

  try {
    return await issueTokenPair(clientId, randomUUID());
  } catch {
    return tokenError("server_error", 500);
  }
}

async function handleRefreshToken(form: FormData) {
  const refreshToken = (form.get("refresh_token") as string) || "";
  if (!refreshToken) return tokenError("invalid_request");

  const hash = hashToken(refreshToken);

  // Look up first (ignoring revoked/expired) so the family is known even if
  // the claim below fails — needed to detect and punish reuse.
  const { data: existing } = await supabase
    .from("oauth_tokens")
    .select("client_id, family_id, revoked_at, expires_at")
    .eq("token_hash", hash)
    .eq("token_type", "refresh")
    .maybeSingle();

  if (!existing) return tokenError("invalid_grant");

  const { data: claimed } = await supabase
    .from("oauth_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("token_hash", hash)
    .eq("token_type", "refresh")
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("client_id, family_id")
    .single();

  if (!claimed) {
    // Already revoked or expired. If it was already revoked, this is reuse
    // of a stale refresh token — kill the whole session (every token
    // sharing this family_id), per OAuth 2.1 rotation-with-reuse-detection.
    if (existing.revoked_at) {
      await supabase.from("oauth_tokens").update({ revoked_at: new Date().toISOString() }).eq("family_id", existing.family_id).is("revoked_at", null);
    }
    return tokenError("invalid_grant");
  }

  try {
    return await issueTokenPair(claimed.client_id, claimed.family_id);
  } catch {
    return tokenError("server_error", 500);
  }
}

export async function POST(request: Request) {
  const form = await request.formData();
  const grantType = form.get("grant_type");

  if (grantType === "authorization_code") return handleAuthorizationCode(form);
  if (grantType === "refresh_token") return handleRefreshToken(form);
  return tokenError("unsupported_grant_type");
}
