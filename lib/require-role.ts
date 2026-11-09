import { AsyncLocalStorage } from "node:async_hooks";
import { headers } from "next/headers";
import { STAFF_ROLE_HEADER, STAFF_ROLE_PROOF_HEADER, verifyStaffRole } from "@/lib/staff-role-proof";

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
 * The role comes from the `x-staff-role` request header, which only proxy.ts
 * can set: the proxy runs on every app route, strips any copy the client sent,
 * and sets it (from the signed-in user's `staff` row) together with an HMAC
 * proof in `x-staff-role-proof`. The role is trusted only when that proof
 * checks out, so a forged header alone is worth nothing, even on a route the
 * proxy somehow skipped.
 */
export async function getStaffRole(): Promise<StaffRole | null> {
  const trusted = trustedRole.getStore();
  if (trusted) return trusted;
  const requestHeaders = await headers();
  const value = requestHeaders.get(STAFF_ROLE_HEADER);
  if (value !== "owner" && value !== "office" && value !== "tech") return null;
  return (await verifyStaffRole(value, requestHeaders.get(STAFF_ROLE_PROOF_HEADER))) ? value : null;
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
