import { AsyncLocalStorage } from "node:async_hooks";
import { headers } from "next/headers";

export type StaffRole = "owner" | "office" | "tech";

const trustedRole = new AsyncLocalStorage<StaffRole>();

/**
 * For server-to-server callers that authenticate with their own secret and
 * never pass through proxy.ts (Copilot bridge, MCP endpoint), so they have no
 * x-staff-role header. Wrap the work in this only AFTER the caller has been
 * authenticated; the role is held in server memory and cannot be client-set.
 */
export function runAsStaffRole<T>(role: StaffRole, fn: () => T): T {
  return trustedRole.run(role, fn);
}

/**
 * Reads the signed-in staff role for the current request.
 *
 * The role comes from the `x-staff-role` request header. proxy.ts always
 * overwrites that header for every internal path (session login looks up the
 * `staff` table; the shared Basic-auth login is treated as owner) and drops
 * any value the client sent, so it can be trusted inside internal server
 * actions and route handlers. Do not use it on public (non-proxied) routes.
 */
export async function getStaffRole(): Promise<StaffRole | null> {
  const trusted = trustedRole.getStore();
  if (trusted) return trusted;
  const value = (await headers()).get("x-staff-role");
  return value === "owner" || value === "office" || value === "tech" ? value : null;
}

/** Throws Error("Not allowed") unless the caller's role is in `allowed`. */
export async function requireRole(allowed: StaffRole[]): Promise<StaffRole> {
  const role = await getStaffRole();
  if (!role || !allowed.includes(role)) throw new Error("Not allowed");
  return role;
}

export function requireOwner() {
  return requireRole(["owner"]);
}

/** Owner or office. Use for anything that moves money, edits financial documents, sends to customers or deletes. */
export function requireOffice() {
  return requireRole(["owner", "office"]);
}
