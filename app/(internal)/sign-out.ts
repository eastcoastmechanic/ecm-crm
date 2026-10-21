"use server";

import { redirect } from "next/navigation";
import { createPortalServerClient } from "@/lib/supabase-portal/server";

// Staff sign-out (the portal has its own). Sends the user back to the staff login.
export async function staffSignOut() {
  const supabase = await createPortalServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
