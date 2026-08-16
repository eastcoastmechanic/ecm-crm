/**
 * Pushes CRM records into a Microsoft Graph external connection so Microsoft
 * 365 Copilot can search and answer questions from live CRM data (customers,
 * jobs, documents) rather than only files that happen to sit in
 * OneDrive/SharePoint.
 *
 * Auth is client-credentials (app-only) against the Azure AD app registered
 * for this connector — no user ever signs in. Requires
 * ExternalConnection.ReadWrite.OwnedBy and ExternalItem.ReadWrite.OwnedBy
 * application permissions, admin-consented once in the Entra admin center.
 *
 * Auth uses a certificate-signed JWT assertion rather than a client secret:
 * East Coast Mechanical's tenant has a policy blocking client-secret
 * creation entirely ("Client secrets are blocked by a tenant-wide policy"),
 * which certificate credentials aren't subject to.
 *
 * Every sync function swallows its own errors: a Copilot indexing hiccup
 * must never break the CRM action (creating a customer, closing a job) that
 * triggered it.
 */
import { randomUUID, sign } from "crypto";
import { supabase } from "@/lib/supabase";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const SITE_ORIGIN = "https://eastcoastmechanical.org";
export const CONNECTION_ID = process.env.MS_GRAPH_CONNECTION_ID || "ecmcrm";

function graphConfigured(): boolean {
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

/**
 * Builds the JWT client assertion Entra expects in place of a client
 * secret (RFC 7523). x5t in the header must be the SHA-1 thumbprint of the
 * certificate uploaded to the app registration — Entra uses it to pick
 * which of the app's certs to verify the signature against.
 */
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

async function getGraphToken(): Promise<string> {
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

async function graphFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getGraphToken();
  return fetch(`${GRAPH_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
  });
}

export type CrmItemType = "customer" | "job" | "document";

type CrmExternalItem = {
  type: CrmItemType;
  id: string;
  title: string;
  content: string;
  url: string;
  properties: Record<string, string | number | null>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Graph's connector endpoint 502s/504s under concurrent load (seen directly
// during backfill: dozens of items PUT in parallel), not because the
// request is bad -- a short retry clears it. 4xx errors are real problems
// (bad payload, auth) and retrying won't help, so those fail immediately.
async function graphFetchWithRetry(path: string, init: RequestInit): Promise<Response> {
  let lastRes: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(300 * attempt);
    const res = await graphFetch(path, init);
    if (res.ok || res.status < 500) return res;
    lastRes = res;
  }
  return lastRes!;
}

// "everyone" is Graph's literal ACL value for a connection scoped to the
// whole tenant — this is a one-person company, so there's no narrower group
// worth modeling.
async function pushCrmItem(item: CrmExternalItem): Promise<boolean> {
  if (!graphConfigured()) return true;
  const itemId = `${item.type}-${item.id}`;
  const res = await graphFetchWithRetry(`/external/connections/${CONNECTION_ID}/items/${itemId}`, {
    method: "PUT",
    body: JSON.stringify({
      acl: [{ type: "everyone", value: "everyone", accessType: "grant" }],
      properties: { itemType: item.type, title: item.title, url: item.url, ...item.properties },
      content: { value: item.content, type: "text" },
    }),
  });
  if (!res.ok) {
    console.error(`[graph-connector] push failed for ${itemId}: ${res.status} ${await res.text()}`);
    return false;
  }
  return true;
}

async function deleteCrmItem(type: CrmItemType, id: string): Promise<boolean> {
  if (!graphConfigured()) return true;
  const itemId = `${type}-${id}`;
  const res = await graphFetchWithRetry(`/external/connections/${CONNECTION_ID}/items/${itemId}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404) {
    console.error(`[graph-connector] delete failed for ${itemId}: ${res.status} ${await res.text()}`);
    return false;
  }
  return true;
}

export async function syncCustomerToGraph(customerId: string): Promise<boolean> {
  try {
    const { data: customer } = await supabase
      .from("customers")
      .select("id,name,email,phone,billing_address,notes")
      .eq("id", customerId)
      .single();
    if (!customer) return true;

    return await pushCrmItem({
      type: "customer",
      id: customer.id,
      title: customer.name ?? "Customer",
      content: [customer.name, customer.email, customer.phone, customer.billing_address, customer.notes]
        .filter(Boolean)
        .join("\n"),
      url: `${SITE_ORIGIN}/customers/${customer.id}`,
      properties: {
        customerName: customer.name ?? "",
        phone: customer.phone ?? "",
        email: customer.email ?? "",
        address: customer.billing_address ?? "",
      },
    });
  } catch (err) {
    console.error(`[graph-connector] customer sync failed for ${customerId}:`, err);
    return false;
  }
}

export async function deleteCustomerFromGraph(customerId: string): Promise<boolean> {
  return deleteCrmItem("customer", customerId).catch((err) => {
    console.error(`[graph-connector] customer delete failed for ${customerId}:`, err);
    return false;
  });
}

export async function syncJobToGraph(jobId: string): Promise<boolean> {
  try {
    const { data: job } = await supabase
      .from("jobs")
      .select("id,status,scheduled_at,notes,customers(name),properties(address)")
      .eq("id", jobId)
      .single();
    if (!job) return true;

    const customer = job.customers as unknown as { name: string | null } | null;
    const property = job.properties as unknown as { address: string | null } | null;
    const title = [customer?.name, property?.address].filter(Boolean).join(" — ") || "Job";

    return await pushCrmItem({
      type: "job",
      id: job.id,
      title,
      content: [title, `Status: ${job.status}`, job.notes].filter(Boolean).join("\n"),
      url: `${SITE_ORIGIN}/jobs`,
      properties: {
        status: job.status ?? "",
        customerName: customer?.name ?? "",
        address: property?.address ?? "",
        scheduledAt: job.scheduled_at ?? null,
      },
    });
  } catch (err) {
    console.error(`[graph-connector] job sync failed for ${jobId}:`, err);
    return false;
  }
}

export async function deleteJobFromGraph(jobId: string): Promise<boolean> {
  return deleteCrmItem("job", jobId).catch((err) => {
    console.error(`[graph-connector] job delete failed for ${jobId}:`, err);
    return false;
  });
}

export async function syncDocumentToGraph(documentId: string): Promise<boolean> {
  try {
    const { data: doc } = await supabase
      .from("documents")
      .select("id,doc_number,type,status,total,customers(name),properties(address)")
      .eq("id", documentId)
      .single();
    if (!doc) return true;

    const customer = doc.customers as unknown as { name: string | null } | null;
    const property = doc.properties as unknown as { address: string | null } | null;
    const title = `${doc.doc_number ?? doc.type} — ${customer?.name ?? "Unknown customer"}`;

    return await pushCrmItem({
      type: "document",
      id: doc.id,
      title,
      content: [title, property?.address, doc.status ? `Status: ${doc.status}` : null]
        .filter(Boolean)
        .join("\n"),
      url: `${SITE_ORIGIN}/documents/${doc.id}`,
      properties: {
        docType: doc.type ?? "",
        status: doc.status ?? "",
        customerName: customer?.name ?? "",
        address: property?.address ?? "",
        total: doc.total ?? null,
      },
    });
  } catch (err) {
    console.error(`[graph-connector] document sync failed for ${documentId}:`, err);
    return false;
  }
}

export async function deleteDocumentFromGraph(documentId: string): Promise<boolean> {
  return deleteCrmItem("document", documentId).catch((err) => {
    console.error(`[graph-connector] document delete failed for ${documentId}:`, err);
    return false;
  });
}
