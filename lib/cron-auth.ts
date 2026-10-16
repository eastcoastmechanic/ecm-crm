import { timingSafeEqual } from "node:crypto";

/**
 * Cron routes accept only `Authorization: Bearer <CRON_SECRET>`.
 * If CRON_SECRET is not set, every request is rejected. Comparing against a
 * template string would otherwise accept the literal header "Bearer undefined".
 */
export function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
