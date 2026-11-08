import Link from "next/link";
import { createPortalServerClient } from "@/lib/supabase-portal/server";
import { headers } from "next/headers";
import ChangePasswordForm from "./ChangePasswordForm";
import TeamsTestButton from "./TeamsTestButton";
import OneNoteCard from "./OneNoteCard";
import BotKeysCard, { type BotKeyRow } from "./BotKeysCard";
import { supabase as db } from "@/lib/supabase";
import { connectionStatus } from "@/lib/microsoft-delegated";
import { headingClass, subTextClass, buttonClass } from "../ui";

const BOT_KEY_COLUMNS = "id, name, token_hint, created_at, last_used_at, revoked_at";
const REVOKED_KEYS_SHOWN = 20;

async function loadBotKeys(): Promise<{ keys: BotKeyRow[]; tableMissing: boolean }> {
  const [live, revoked] = await Promise.all([
    db
      .from("bot_keys")
      .select(BOT_KEY_COLUMNS)
      .is("revoked_at", null)
      .order("created_at", { ascending: false }),
    db
      .from("bot_keys")
      .select(BOT_KEY_COLUMNS)
      .not("revoked_at", "is", null)
      .order("revoked_at", { ascending: false })
      .limit(REVOKED_KEYS_SHOWN),
  ]);
  return {
    keys: [...(live.data ?? []), ...(revoked.data ?? [])] as BotKeyRow[],
    tableMissing: Boolean(live.error || revoked.error),
  };
}

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ onenote?: string }> }) {
  const supabase = await createPortalServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isOwner = (await headers()).get("x-staff-role") === "owner";
  const oneNote = isOwner ? await connectionStatus() : null;
  const oneNoteResult = isOwner ? ((await searchParams).onenote ?? null) : null;
  // Every live key is listed (no cap) so each one keeps its Revoke button.
  // Only the revoked history is capped.
  const botKeys = isOwner ? await loadBotKeys() : null;

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

      {isOwner && botKeys && (
        <div className="flex flex-col gap-3 rounded-xl border border-white/8 p-4">
          <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Bot keys</h2>
          <BotKeysCard keys={botKeys.keys} tableMissing={botKeys.tableMissing} />
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
