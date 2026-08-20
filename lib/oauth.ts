import { createHash, randomBytes, timingSafeEqual } from "crypto";

/**
 * Shared crypto/constants for the OAuth 2.1 + PKCE + DCR authorization
 * server (app/api/oauth/*, app/.well-known/oauth-*). Node-only (uses
 * `crypto`) -- fine here since every caller is a Node route handler, unlike
 * lib/internal-auth.ts which also has to run on proxy.ts's Edge runtime.
 */

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days
export const AUTH_CODE_TTL_SECONDS = 120; // 2 minutes

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function verifyPkce(verifier: string, challenge: string): boolean {
  const computed = createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
