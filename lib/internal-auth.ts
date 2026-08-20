/**
 * Shared credential check for the app's one internal login: proxy.ts's
 * Basic-Auth gate and the new OAuth /authorize login form both check the
 * same two env vars the same way, so there's exactly one place this logic
 * lives instead of two slightly-different copies.
 *
 * Web-standard primitives only (TextEncoder, no `crypto`/`Buffer`) so this
 * runs unchanged on proxy.ts's Edge runtime and the Node route handlers
 * under app/api/oauth/*.
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
