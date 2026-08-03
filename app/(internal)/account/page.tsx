import Link from "next/link";
import { createPortalServerClient } from "@/lib/supabase-portal/server";
import ChangePasswordForm from "./ChangePasswordForm";
import { headingClass, subTextClass, buttonClass } from "../ui";

export default async function AccountPage() {
  const supabase = await createPortalServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={headingClass}>Account</h1>
        <p className={subTextClass}>Manage your sign-in.</p>
      </div>

      {!user ? (
        <div className="flex flex-col gap-3 rounded-xl border border-white/8 bg-white/3 p-4">
          <p className={subTextClass}>
            You&apos;re viewing this through the shared access password, not a personal sign-in, so
            there&apos;s no account here to manage yet. Sign in with your email once to set up a
            personal password.
          </p>
          <Link href="/login" className={`${buttonClass} w-fit`}>
            Sign In
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="rounded-xl border border-white/8 bg-white/3 p-4">
            <div className="text-xs font-bold uppercase tracking-wide text-g300">Signed in as</div>
            <div className="mt-1 text-white">{user.email}</div>
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-white/8 p-4">
            <h2 className="text-xs font-bold uppercase tracking-wide text-g300">
              Set / Change Password
            </h2>
            <ChangePasswordForm />
          </div>
        </div>
      )}
    </div>
  );
}
