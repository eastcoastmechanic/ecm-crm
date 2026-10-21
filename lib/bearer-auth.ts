import { createHash, timingSafeEqual } from "node:crypto";

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

/** Constant-time string equality (hashes first so length does not leak). */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

/** Extracts the token from an `Authorization: Bearer <token>` header, or "". */
export function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

/**
 * True only when `secret` is configured (non-empty) and `token` matches it.
 * Fails closed when the env var is unset, so the literal header
 * "Bearer undefined" never passes.
 */
export function tokenMatches(token: string, secret: string | undefined | null): boolean {
  if (!secret || !token) return false;
  return safeEqual(token, secret);
}

export function bearerAuthorized(request: Request, secret: string | undefined | null): boolean {
  return tokenMatches(bearerToken(request), secret);
}
