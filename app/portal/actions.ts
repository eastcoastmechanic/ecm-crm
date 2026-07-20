"use server";

import { redirect } from "next/navigation";
import { createPortalServerClient } from "@/lib/supabase-portal/server";

export async function signOut() {
  const supabase = await createPortalServerClient();
  await supabase.auth.signOut();
  redirect("/portal/login");
}
