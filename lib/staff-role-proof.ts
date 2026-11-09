/**
 * Proof that the staff role header was set by proxy.ts, not by the caller.
 *
 * proxy.ts strips any incoming `x-staff-role` / `x-staff-role-proof` header on
 * every request, and after it has checked the staff sign-in it sets both: the
 * role, and an HMAC of the role plus a timestamp. `getStaffRole` only trusts
 * the role when the proof checks out, so if a page ever slips past the proxy
 * (matcher gap, refactor) a hand-written `x-staff-role: owner` header is
 * still worthless.
 *
 * The key is derived from a server-only secret (`STAFF_ROLE_SECRET` if set,
 * otherwise `SUPABASE_SERVICE_ROLE_KEY`, which every deployment already has).
 * The raw secret is never used directly or exposed. No secret means no proof
 * can be made or checked, so every role check fails closed.
 *
 * Uses Web Crypto so it runs the same in the proxy and in route code.
 */

export const STAFF_ROLE_HEADER = "x-staff-role";
export const STAFF_ROLE_PROOF_HEADER = "x-staff-role-proof";

/** Headers only the proxy may set. Any copy sent by a client is removed. */
export const INTERNAL_REQUEST_HEADERS = [STAFF_ROLE_HEADER, STAFF_ROLE_PROOF_HEADER] as const;

// A proof is good for this long after the proxy made it. A request is checked
// within seconds of passing the proxy; the window only has to cover a slow render.
const MAX_AGE_MS = 10 * 60 * 1000;
// Small allowance for clock drift between the proxy and the function.
const MAX_FUTURE_MS = 60 * 1000;

const KEY_LABEL = "ecm-crm staff-role-proof v1";

const encoder = new TextEncoder();
let cachedKey: { base: string; key: Promise<CryptoKey> } | null = null;

function baseSecret(): string | null {
  const secret = process.env.STAFF_ROLE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  return secret && secret.trim() ? secret : null;
}

async function deriveKey(base: string): Promise<CryptoKey> {
  // Derive a purpose-specific key so the stored secret itself is never the HMAC key.
  const baseKey = await crypto.subtle.importKey("raw", encoder.encode(base), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const derived = await crypto.subtle.sign("HMAC", baseKey, encoder.encode(KEY_LABEL));
  return crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

function proofKey(): Promise<CryptoKey> | null {
  const base = baseSecret();
  if (!base) return null;
  if (!cachedKey || cachedKey.base !== base) cachedKey = { base, key: deriveKey(base) };
  return cachedKey.key;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function mac(key: CryptoKey, role: string, issuedAt: number): Promise<string> {
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(`${role}.${issuedAt}`)));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Proof for `role`, or null when no server secret is configured. */
export async function signStaffRole(role: string, now: number = Date.now()): Promise<string | null> {
  const key = proofKey();
  if (!key) return null;
  return `${now}.${await mac(await key, role, now)}`;
}

/** True only when `proof` was made by signStaffRole for this role and is still fresh. */
export async function verifyStaffRole(role: string, proof: string | null | undefined, now: number = Date.now()): Promise<boolean> {
  if (!proof) return false;
  const key = proofKey();
  if (!key) return false;
  const match = /^(\d{1,16})\.([0-9a-f]{64})$/.exec(proof);
  if (!match) return false;
  const issuedAt = Number(match[1]);
  if (!Number.isSafeInteger(issuedAt)) return false;
  if (now - issuedAt > MAX_AGE_MS || issuedAt - now > MAX_FUTURE_MS) return false;
  return constantTimeEqual(match[2], await mac(await key, role, issuedAt));
}
