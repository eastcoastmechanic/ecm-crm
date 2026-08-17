/**
 * Shared Microsoft Graph app-only auth: certificate-signed JWT client
 * assertion (RFC 7523) instead of a client secret, since East Coast
 * Mechanical's tenant blocks client-secret creation by policy. Used by
 * every Graph integration on the same app registration (the Copilot search
 * connector, and the Planner connector) — one token cache, one place that
 * knows how to sign the assertion.
 */
import { randomUUID, sign } from "crypto";

export const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export function graphConfigured(): boolean {
  return Boolean(
    process.env.MS_GRAPH_TENANT_ID &&
      process.env.MS_GRAPH_CLIENT_ID &&
      process.env.MS_GRAPH_CERT_PRIVATE_KEY &&
      process.env.MS_GRAPH_CERT_THUMBPRINT
  );
}

function base64url(input: Buffer): string {
  return input.toString("base64url");
}

function buildClientAssertion(tenantId: string, clientId: string): string {
  const privateKeyPem = process.env.MS_GRAPH_CERT_PRIVATE_KEY!.replace(/\\n/g, "\n");
  const thumbprint = process.env.MS_GRAPH_CERT_THUMBPRINT!;

  const header = { alg: "RS256", typ: "JWT", x5t: thumbprint };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    iss: clientId,
    sub: clientId,
    jti: randomUUID(),
    nbf: now,
    exp: now + 300,
  };

  const signingInput = `${base64url(Buffer.from(JSON.stringify(header)))}.${base64url(Buffer.from(JSON.stringify(payload)))}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), privateKeyPem);
  return `${signingInput}.${base64url(signature)}`;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

export async function getGraphToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }
  const tenantId = process.env.MS_GRAPH_TENANT_ID!;
  const clientId = process.env.MS_GRAPH_CLIENT_ID!;

  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: buildClientAssertion(tenantId, clientId),
    }),
  });
  if (!res.ok) throw new Error(`Graph token request failed: ${res.status} ${await res.text()}`);

  const json = await res.json();
  cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cachedToken.value;
}

export async function graphFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getGraphToken();
  return fetch(`${GRAPH_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Graph 502s/504s under load, not because the request is bad -- a short
// retry clears it. 4xx errors are real problems (bad payload, auth, stale
// etag) and retrying won't help, so those fail immediately.
export async function graphFetchWithRetry(path: string, init: RequestInit): Promise<Response> {
  let lastRes: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(300 * attempt);
    const res = await graphFetch(path, init);
    if (res.ok || res.status < 500) return res;
    lastRes = res;
  }
  return lastRes!;
}
