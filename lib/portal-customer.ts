import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createPortalServerClient } from "@/lib/supabase-portal/server";
import { supabase as adminDb } from "@/lib/supabase";

// Who is signed in to the customer portal, and which customer row is theirs.
// The session comes from the portal cookie; every database read and write after
// that uses the service client on the server, scoped to the customer id found
// here. The customer's own Supabase session no longer writes anything (SQL 0070
// drops those policies), so a direct REST call with their login can't change a
// price, a status or a job.

/** The signed-in portal user, or a redirect to the portal login. */
export async function requirePortalUser(): Promise<User> {
  const authClient = await createPortalServerClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) redirect("/portal/login");
  return user;
}

export type PortalCustomer = { id: string; name: string | null };

/** The customer row linked to this login, or null if none is linked yet. */
export async function portalCustomerFor(userId: string): Promise<PortalCustomer | null> {
  const { data, error } = await adminDb
    .from("customers")
    .select("id, name")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("portalCustomerFor: lookup failed", error.message);
    return null;
  }
  return data ? { id: data.id as string, name: (data.name as string | null) ?? null } : null;
}

/**
 * First login: link the customer row whose email matches this verified login,
 * only while that row is unclaimed. Writes only auth_user_id. Does nothing if
 * the login has no confirmed email, or this login is already linked.
 */
export async function claimPortalCustomer(user: User): Promise<void> {
  if (!user.email || !user.email_confirmed_at) return;
  if (await portalCustomerFor(user.id)) return;
  const { error } = await adminDb
    .from("customers")
    .update({ auth_user_id: user.id })
    .eq("email", user.email)
    .is("auth_user_id", null);
  if (error) console.error("claimPortalCustomer: link failed", error.message);
}
