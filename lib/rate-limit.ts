const WINDOW_MS = 5 * 60 * 1000;
const MAX_REQUESTS = 20;

const hits = new Map<string, number[]>();

/**
 * Simple in-memory sliding-window limiter for public, unauthenticated API
 * routes. Vercel's Fluid Compute reuses instances across requests rather
 * than spinning up fresh ones each time, so this holds up better than a
 * classic one-request-per-instance serverless model — but it's still
 * per-instance, not a global count. Good enough to blunt casual scripted
 * abuse of a Claude-calling endpoint; not a substitute for real
 * infrastructure-level rate limiting if abuse becomes a real problem.
 */
export function isRateLimited(key: string, maxRequests = MAX_REQUESTS): boolean {
  const now = Date.now();
  const timestamps = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  timestamps.push(now);
  hits.set(key, timestamps);
  return timestamps.length > maxRequests;
}
