import Link from "next/link";
import { createPortalServerClient } from "@/lib/supabase-portal/server";
import { headers } from "next/headers";
import ChangePasswordForm from "./ChangePasswordForm";
import TeamsTestButton from "./TeamsTestButton";
import OneNoteCard from "./OneNoteCard";
import { connectionStatus } from "@/lib/microsoft-delegated";
import { headingClass, subTextClass, buttonClass } from "../ui";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ onenote?: string }> }) {
  const supabase = await createPortalServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isOwner = (await headers()).get("x-staff-role") === "owner";
  const oneNote = isOwner ? await connectionStatus() : null;
  const oneNoteResult = isOwner ? ((await searchParams).onenote ?? null) : null;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={headingClass}>Account</h1>
        <p className={subTextClass}>Manage your sign-in.</p>
      </div>

      {!user ? (
        <div className="flex flex-col gap-3 rounded-xl border border-white/8 bg-white/3 p-4">
          <p className={subTextClass}>
            You&apos;re not signed in. Sign in with your email to manage your password.
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

      {isOwner && (
        <div className="flex flex-col gap-3 rounded-xl border border-white/8 p-4">
          <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Microsoft Teams</h2>
          <p className={subTextClass}>
            Posts one test card to each connected Teams channel, naming the channel it should
            appear in.
          </p>
          <TeamsTestButton />
        </div>
      )}

      {isOwner && oneNote && (
        <div className="flex flex-col gap-3 rounded-xl border border-white/8 p-4">
          <h2 className="text-xs font-bold uppercase tracking-wide text-g300">OneNote</h2>
          <OneNoteCard
            connected={oneNote.connected}
            account={oneNote.account}
            connectedAt={oneNote.connectedAt}
            lastError={oneNote.lastError}
            result={oneNoteResult}
          />
        </div>
      )}
    </div>
  );
}
