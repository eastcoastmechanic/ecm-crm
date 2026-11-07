import { createHash, randomBytes } from "node:crypto";
import { supabase } from "@/lib/supabase";
import { buildClientAssertion, graphConfigured, GRAPH_BASE } from "@/lib/graph-auth";
import { decryptToken, encryptToken } from "@/lib/token-crypto";

/**
 * Microsoft sign-in as a person (delegated), used only for OneNote: since
 * 2025-03-31 OneNote no longer accepts app-only tokens, which is how the rest
 * of the Graph code (Copilot connector, Planner, job folders) signs in.
 *
 * The owner connects once from /account. The refresh token is stored
 * encrypted in `microsoft_connections` (SQL 0066, service role only) and
 * rotated on every use. Same app registration and certificate as graph-auth;
 * no client secret (the tenant blocks them).
 */

export const CONNECTION_ID = "onenote";
/** Short-lived httpOnly cookie holding the sign-in state and PKCE verifier (/api/microsoft only). */
export const OAUTH_COOKIE = "ms_onenote_oauth";
// Sites.Read.All (read only) finds the ecmjobs site from its document library; Notes.ReadWrite.All writes the pages.
const SCOPES = "openid profile offline_access User.Read Sites.Read.All Notes.ReadWrite.All";
const TOKEN_PURPOSE = "ecm-crm microsoft refresh token v1";

function tenantId() {
  return process.env.MS_GRAPH_TENANT_ID!;
}
function clientId() {
  return process.env.MS_GRAPH_CLIENT_ID!;
}
function sealSecret(): string {
  return process.env.MS_GRAPH_CERT_PRIVATE_KEY!;
}

export function delegatedConfigured(): boolean {
  return graphConfigured();
}

/** PKCE pair for the sign-in round trip. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function randomState(): string {
  return randomBytes(24).toString("base64url");
}

export function authorizeUrl(input: { redirectUri: string; state: string; codeChallenge: string }): string {
  const url = new URL(`https://login.microsoftonline.com/${tenantId()}/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id", clientId());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  error?: string;
  error_description?: string;
};

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`https://login.microsoftonline.com/${tenantId()}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId(),
      scope: SCOPES,
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: buildClientAssertion(tenantId(), clientId()),
      ...params,
    }),
  });
  return (await res.json().catch(() => ({ error: `http_${res.status}` }))) as TokenResponse;
}

/** Signed-in account name from the id token (read straight from Microsoft over TLS, display only). */
function accountFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"));
    return (payload.preferred_username as string) || (payload.email as string) || (payload.name as string) || null;
  } catch {
    return null;
  }
}

// Tied to the connection it came from (connected_at), so a reconnect or disconnect drops it.
let cached: { token: string; expiresAt: number; connectedAtMs: number } | null = null;

/** Finish the sign-in: trade the code for tokens and store the refresh token, encrypted. */
export async function completeSignIn(input: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
  staffId: string | null;
}): Promise<{ ok: true; account: string | null } | { ok: false; error: string }> {
  const json = await tokenRequest({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  });
  if (!json.refresh_token || !json.access_token) {
    // Microsoft's own error code only (no tokens), so the owner can see what to fix.
    return { ok: false, error: json.error ?? "no_refresh_token" };
  }
  const account = accountFromIdToken(json.id_token);
  const connectedAt = new Date();
  const { error } = await supabase.from("microsoft_connections").upsert({
    id: CONNECTION_ID,
    account,
    refresh_token_enc: encryptToken(json.refresh_token, sealSecret(), TOKEN_PURPOSE),
    connected_by: input.staffId,
    connected_at: connectedAt.toISOString(),
    last_error: null,
    updated_at: connectedAt.toISOString(),
  });
  if (error) return { ok: false, error: "save_failed" };
  cached = {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    connectedAtMs: connectedAt.getTime(),
  };
  return { ok: true, account };
}

export type ConnectionStatus = {
  connected: boolean;
  account: string | null;
  connectedAt: string | null;
  lastError: string | null;
};

export async function connectionStatus(): Promise<ConnectionStatus> {
  const { data } = await supabase
    .from("microsoft_connections")
    .select("account, connected_at, last_error, refresh_token_enc")
    .eq("id", CONNECTION_ID)
    .maybeSingle();
  return {
    connected: !!data?.refresh_token_enc,
    account: (data?.account as string | null) ?? null,
    connectedAt: (data?.connected_at as string | null) ?? null,
    lastError: (data?.last_error as string | null) ?? null,
  };
}

export async function disconnect(): Promise<void> {
  cached = null;
  await supabase.from("microsoft_connections").delete().eq("id", CONNECTION_ID);
}

/**
 * Access token as the connected person, refreshing (and rotating the stored
 * refresh token) when needed. Null when nobody is connected or the sign-in
 * has expired; the reason is saved on the row for /account to show.
 */
export async function getDelegatedToken(attempt = 0): Promise<string | null> {
  if (!delegatedConfigured()) return null;

  // Read the connection every time, even with a cached token: a disconnect or
  // reconnect on another server instance must take effect here at once.
  const { data } = await supabase
    .from("microsoft_connections")
    .select("refresh_token_enc, connected_at")
    .eq("id", CONNECTION_ID)
    .maybeSingle();
  if (!data?.refresh_token_enc) {
    cached = null;
    return null;
  }
  const connectedAtMs = new Date(data.connected_at as string).getTime();
  if (cached && cached.connectedAtMs === connectedAtMs && cached.expiresAt > Date.now() + 60_000) return cached.token;

  // Every write below only lands on the same connection this refresh started from
  // (matching connected_at). If the owner reconnected meanwhile, the new sign-in wins.
  const refreshToken = decryptToken(data.refresh_token_enc as string, sealSecret(), TOKEN_PURPOSE);
  if (!refreshToken) {
    await supabase
      .from("microsoft_connections")
      .update({ last_error: "Stored sign-in can't be read (certificate changed?). Reconnect.", updated_at: new Date().toISOString() })
      .eq("id", CONNECTION_ID)
      .eq("connected_at", data.connected_at as string);
    return null;
  }

  const json = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
  if (!json.access_token) {
    await supabase
      .from("microsoft_connections")
      .update({ last_error: `Microsoft refused the saved sign-in (${json.error ?? "unknown"}). Reconnect.`, updated_at: new Date().toISOString() })
      .eq("id", CONNECTION_ID)
      .eq("connected_at", data.connected_at as string);
    return null;
  }

  const update: Record<string, unknown> = { last_error: null, updated_at: new Date().toISOString() };
  if (json.refresh_token) update.refresh_token_enc = encryptToken(json.refresh_token, sealSecret(), TOKEN_PURPOSE);
  const { data: saved, error: saveError } = await supabase
    .from("microsoft_connections")
    .update(update)
    .eq("id", CONNECTION_ID)
    .eq("connected_at", data.connected_at as string)
    .select("id");
  if (!saveError && (!saved || saved.length === 0)) {
    // Reconnected or disconnected while this refresh ran: drop the old account's
    // token and start over (once) from whatever connection is saved now.
    cached = null;
    return attempt < 1 ? getDelegatedToken(attempt + 1) : null;
  }
  // A database error here still leaves a good token for this run; the next
  // refresh retries the save (Microsoft keeps the old refresh token valid).

  cached = { token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000, connectedAtMs };
  return cached.token;
}

/** Graph call as the connected person. Null when not connected. */
export async function delegatedFetch(path: string, init: RequestInit = {}): Promise<Response | null> {
  const token = await getDelegatedToken();
  if (!token) return null;
  return fetch(`${GRAPH_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
  });
}
