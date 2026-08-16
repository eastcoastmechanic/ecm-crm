// Shared Microsoft Graph helpers for the external-connection setup and
// backfill scripts. Mirrors lib/graph-connector.ts's push/delete shape, but
// these run as plain Node scripts (no Next.js/TS build step) against your
// local .env.local, not the app's server runtime.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { randomUUID, sign } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const root = path.join(__dirname, "..");

export function loadEnvLocal() {
  const envPath = path.join(root, ".env.local");
  const text = readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
export const CONNECTION_ID = process.env.MS_GRAPH_CONNECTION_ID || "ecmcrm";

function base64url(input) {
  return input.toString("base64url");
}

// Certificate-signed JWT assertion (RFC 7523) rather than a client secret --
// this tenant blocks client-secret creation by policy. Mirrors
// lib/graph-connector.ts's buildClientAssertion exactly.
function buildClientAssertion(tenantId, clientId) {
  const privateKeyPem = process.env.MS_GRAPH_CERT_PRIVATE_KEY.replace(/\\n/g, "\n");
  const thumbprint = process.env.MS_GRAPH_CERT_THUMBPRINT;

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

export async function getGraphToken() {
  const tenantId = process.env.MS_GRAPH_TENANT_ID;
  const clientId = process.env.MS_GRAPH_CLIENT_ID;
  const privateKey = process.env.MS_GRAPH_CERT_PRIVATE_KEY;
  const thumbprint = process.env.MS_GRAPH_CERT_THUMBPRINT;
  if (!tenantId || !clientId || !privateKey || !thumbprint) {
    throw new Error(
      "Missing MS_GRAPH_TENANT_ID / MS_GRAPH_CLIENT_ID / MS_GRAPH_CERT_PRIVATE_KEY / MS_GRAPH_CERT_THUMBPRINT in .env.local"
    );
  }
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
  return json.access_token;
}

export async function graphFetch(token, path, init = {}) {
  return fetch(`${GRAPH_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
  });
}

export async function pushItem(token, item) {
  const itemId = `${item.type}-${item.id}`;
  const res = await graphFetch(token, `/external/connections/${CONNECTION_ID}/items/${itemId}`, {
    method: "PUT",
    body: JSON.stringify({
      acl: [{ type: "everyone", value: "everyone", accessType: "grant" }],
      properties: { itemType: item.type, title: item.title, url: item.url, ...item.properties },
      content: { value: item.content, type: "text" },
    }),
  });
  if (!res.ok) {
    console.error(`  ✗ ${itemId}: ${res.status} ${await res.text()}`);
    return false;
  }
  return true;
}
