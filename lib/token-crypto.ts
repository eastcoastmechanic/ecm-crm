import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// Encrypts a stored token (the Microsoft refresh token for OneNote) so a
// database read alone never yields a usable credential. AES-256-GCM, key
// derived (HKDF) from the Graph certificate private key that is already a
// server-only secret, so no new env var is needed. If the certificate is
// replaced, old tokens can no longer be read and the owner reconnects once.

const VERSION = "v1";

function key(secret: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret), Buffer.alloc(0), Buffer.from(purpose), 32));
}

export function encryptToken(plain: string, secret: string, purpose: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret, purpose), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), body.toString("base64url")].join(".");
}

/** Null when the value is malformed, tampered with, or was sealed with another key. */
export function decryptToken(sealed: string, secret: string, purpose: string): string | null {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || !body) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(secret, purpose), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
