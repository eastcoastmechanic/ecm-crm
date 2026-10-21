import { bearerAuthorized } from "@/lib/bearer-auth";

/**
 * Cron routes accept only `Authorization: Bearer <CRON_SECRET>`.
 * If CRON_SECRET is not set, every request is rejected. Comparing against a
 * template string would otherwise accept the literal header "Bearer undefined".
 */
export function cronAuthorized(request: Request): boolean {
  return bearerAuthorized(request, process.env.CRON_SECRET);
}
