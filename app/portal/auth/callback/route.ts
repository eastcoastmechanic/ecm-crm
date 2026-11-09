import { NextResponse } from "next/server";
import { createPortalServerClient } from "@/lib/supabase-portal/server";
import { claimPortalCustomer } from "@/lib/portal-customer";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createPortalServerClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user?.email) {
      // First login: link the customer record matching this verified email,
      // only while it's unclaimed (done on the server, see lib/portal-customer.ts).
      await claimPortalCustomer(data.user);

      return NextResponse.redirect(`${origin}/portal`);
    }
  }

  return NextResponse.redirect(`${origin}/portal/login`);
}
