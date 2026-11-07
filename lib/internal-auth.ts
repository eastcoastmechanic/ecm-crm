/**
 * Credential check for the OAuth /authorize login form (connecting Claude or
 * another MCP app). The CRM pages used to accept this same login as Basic
 * auth in proxy.ts; that is retired, staff sign in with their own account.
 *
 * Web-standard primitives only (TextEncoder, no `crypto`/`Buffer`).
 */
function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  const length = Math.max(aBytes.length, bBytes.length, 1);
  // Always compares up to the longer length so a shorter guess doesn't
  // finish early — deliberately not short-circuiting on a length mismatch.
  let diff = aBytes.length === bBytes.length ? 0 : 1;
  for (let i = 0; i < length; i++) diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  return diff === 0;
}

export function verifyInternalCredentials(username: string, password: string): boolean {
  const expectedUser = process.env.INTERNAL_AUTH_USER;
  const expectedPass = process.env.INTERNAL_AUTH_PASSWORD;
  // Fail closed if the gate isn't configured — never fall back to "open".
  if (!expectedUser || !expectedPass) return false;

  return constantTimeEqual(username, expectedUser) && constantTimeEqual(password, expectedPass);
}
