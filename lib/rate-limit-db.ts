import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { supabase } from "@/lib/supabase";
import { isRateLimited } from "@/lib/rate-limit";
import { isMissingFunctionError } from "@/lib/doc-number";
import { phoneKey } from "@/lib/phone";
import { COMPANY_PHONE_DISPLAY } from "@/lib/brand";

/**
 * Rate limits for the public forms that hold across every Vercel server.
 *
 * Counts live in the database (SQL 0074, rate_limit_hit()). Until 0074 is run,
 * or if the database call fails, we fall back to the per-server memory limit
 * in lib/rate-limit.ts: a limiter problem must never lock real customers out.
 */

export const RATE_LIMITED_MESSAGE = `Too many tries. Please wait a bit or call ${COMPANY_PHONE_DISPLAY}.`;

export const HOUR = 60 * 60;
export const DAY = 24 * HOUR;

export type LimitRule = { key: string; limit: number; windowSeconds: number };

/** Limits per form. Phone and email limits catch one target hit from many IPs. */
export const LIMITS = {
  smsSignupPerIp: { limit: 5, windowSeconds: HOUR },
  smsSignupPerPhone: { limit: 3, windowSeconds: DAY },
  /** Every "Reply YES" confirmation text from the website (sign-up and booking), all visitors together. */
  optInTextsGlobal: { limit: 100, windowSeconds: HOUR },
  bookPerIp: { limit: 10, windowSeconds: HOUR },
  bookPerPhone: { limit: 5, windowSeconds: DAY },
  contactPerIp: { limit: 10, windowSeconds: HOUR },
  contactPerEmail: { limit: 5, windowSeconds: DAY },
  chatPerIp: { limit: 60, windowSeconds: HOUR },
  /** Survey, unsubscribe and visit links: the token is the only credential, so cap guessing. */
  tokenLinkPerIp: { limit: 20, windowSeconds: HOUR },
} as const;

/** Client IP on Vercel: first hop of x-forwarded-for, else x-real-ip. */
export function clientIpFrom(h: Pick<Headers, "get">): string {
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  return h.get("x-real-ip")?.trim() || "unknown";
}

/** Client IP of the request behind the current server action. */
export async function requestIp(): Promise<string> {
  try {
    return clientIpFrom(await headers());
  } catch {
    return "unknown";
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

/**
 * Key for one counter, e.g. "sms-signup:phone:3f2a...". The value is hashed so
 * no phone number, email or IP is stored in rate_limit_hits. Phones and emails
 * are normalized first so "(508) 555-0100" and "5085550100" share a counter.
 */
export function rateKey(scope: string, kind: "ip" | "phone" | "email", value: string): string {
  let normalized = value.trim().toLowerCase();
  if (kind === "phone") normalized = phoneKey(normalized);
  return `${scope}:${kind}:${hash(normalized)}`;
}

/** One counter shared by every visitor, e.g. all confirmation texts. */
export function globalKey(scope: string): string {
  return `${scope}:global`;
}

let warnedFallback = false;
function warnFallbackOnce(reason: string) {
  if (warnedFallback) return;
  warnedFallback = true;
  console.error(`rate limit: using the per-server memory limit (${reason})`);
}

/** Tests only. */
export function resetRateLimitWarningForTests() {
  warnedFallback = false;
}

/**
 * Records one request against `key` and says whether it's allowed (at most
 * `limit` per `windowSeconds`). Falls back to the memory limiter if the
 * database function is missing or the call fails.
 */
export async function allowRequest(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("rate_limit_hit", {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (!error && typeof data === "boolean") return data;
    warnFallbackOnce(
      error
        ? isMissingFunctionError(error)
          ? "rate_limit_hit() not found, run SQL 0074"
          : `database error: ${error.message}`
        : "unexpected reply"
    );
  } catch (err) {
    warnFallbackOnce(`database call failed: ${err instanceof Error ? err.message : "unknown error"}`);
  }
  return !isRateLimited(`db-fallback:${key}`, limit, windowSeconds * 1000);
}

/**
 * Checks each rule in order and stops at the first one that's over its limit
 * (later counters aren't touched then). True only when every rule allows it.
 */
export async function allowAll(rules: LimitRule[]): Promise<boolean> {
  for (const rule of rules) {
    if (!(await allowRequest(rule.key, rule.limit, rule.windowSeconds))) return false;
  }
  return true;
}

/** Shorthand: a rule from a LIMITS entry and a key. */
export function rule(key: string, limit: { limit: number; windowSeconds: number }): LimitRule {
  return { key, limit: limit.limit, windowSeconds: limit.windowSeconds };
}

/** Counter for every website "Reply YES" confirmation text (each one is a paid text). */
export const OPT_IN_TEXTS_KEY = globalKey("optin-text");
