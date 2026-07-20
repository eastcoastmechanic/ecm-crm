import { NextResponse } from "next/server";
import { createPortalServerClient } from "@/lib/supabase-portal/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createPortalServerClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user?.email) {
      // First login: claim the customer record matching this verified
      // email (RLS only allows this when the row is unclaimed — see
      // db/migrations/0003_portal_auth.sql).
      await supabase
        .from("customers")
        .update({ auth_user_id: data.user.id })
        .eq("email", data.user.email)
        .is("auth_user_id", null);

      return NextResponse.redirect(`${origin}/portal`);
    }
  }

  return NextResponse.redirect(`${origin}/portal/login`);
}
