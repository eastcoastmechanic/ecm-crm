// Limits on the public OAuth endpoints (connecting Claude or another MCP
// client). Counts come from the database so they hold across every server
// instance, unlike lib/rate-limit.ts. Pure rules here; the routes do the I/O.

/** New client registrations allowed per hour, across everyone. Real use is a handful ever. */
export const REGISTRATIONS_PER_HOUR = 5;

/** Failed sign-ins on the connect page, counted over this window. */
export const LOGIN_WINDOW_MINUTES = 15;
export const MAX_FAILURES_PER_IP = 5;
/** Across all addresses, so spreading a guessing run over many IPs still stops. */
export const MAX_FAILURES_TOTAL = 20;

export function registrationAllowed(registeredLastHour: number | null): boolean {
  // Unknown count (query failed): refuse rather than open the door.
  return registeredLastHour !== null && registeredLastHour < REGISTRATIONS_PER_HOUR;
}

/**
 * Locked when this address or everyone together has too many recent failures.
 * Checked before the password, so a right guess during a lockout still fails.
 */
export function loginLocked(counts: { ipFailures: number | null; allFailures: number | null }): boolean {
  if (counts.ipFailures === null || counts.allFailures === null) return true;
  return counts.ipFailures >= MAX_FAILURES_PER_IP || counts.allFailures >= MAX_FAILURES_TOTAL;
}

/** The site a connection would send its access to, for the sign-in warning. */
export function redirectHost(redirectUri: string): string {
  try {
    return new URL(redirectUri).host;
  } catch {
    return "an unknown site";
  }
}

export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
