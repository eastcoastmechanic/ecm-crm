import Link from "next/link";
import { createPortalServerClient } from "@/lib/supabase-portal/server";
import { headers } from "next/headers";
import ChangePasswordForm from "./ChangePasswordForm";
import TeamsTestButton from "./TeamsTestButton";
import OneNoteCard from "./OneNoteCard";
import RebuildJobLogsButton from "./RebuildJobLogsButton";
import BotKeysCard, { type BotKeyRow } from "./BotKeysCard";
import RundownCard, { type RundownOverview } from "./RundownCard";
import { getStaffRole } from "@/lib/require-role";
import { supabase as db } from "@/lib/supabase";
import { connectionStatus } from "@/lib/microsoft-delegated";
import { headingClass, subTextClass, buttonClass } from "../ui";

// Creating the Daily Rundown planner waits on Microsoft (a new group can take a while).
export const maxDuration = 60;

/** Owner only: latest rundown run and open items (they carry money flags). */
async function loadRundownOverview(): Promise<RundownOverview> {
  const [config, run, open, waiting, errors] = await Promise.all([
    db.from("rundown_planner").select("group_id, plan_id, buckets, last_pull_at, last_error").eq("id", 1).maybeSingle(),
    db
      .from("rundown_runs")
      .select("bot, run_date, received_at, item_count")
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db.from("rundown_items").select("section").eq("status", "open").limit(2000),
    db.from("rundown_items").select("id", { count: "exact", head: true }).eq("needs_push", true),
    db.from("rundown_items").select("id", { count: "exact", head: true }).eq("needs_push", true).not("push_error", "is", null),
  ]);
  const openBySection: Record<string, number> = {};
  for (const row of open.data ?? []) openBySection[row.section as string] = (openBySection[row.section as string] ?? 0) + 1;
  const buckets = (config.data?.buckets ?? {}) as Record<string, string>;
  return {
    tableMissing: Boolean(config.error || run.error || open.error),
    planReady: Boolean(config.data?.plan_id) && Object.keys(buckets).length >= 6,
    groupMade: Boolean(config.data?.group_id),
    lastPullAt: (config.data?.last_pull_at as string | null) ?? null,
    lastError: (config.data?.last_error as string | null) ?? null,
    latestRun: (run.data as RundownOverview["latestRun"]) ?? null,
    openBySection,
    waitingToPush: waiting.count ?? 0,
    pushErrors: errors.count ?? 0,
  };
}

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
  // Checked against the signed role proof, not just the header.
  const rundown = (await getStaffRole()) === "owner" ? await loadRundownOverview() : null;

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

      {rundown && (
        <div className="flex flex-col gap-3 rounded-xl border border-white/8 p-4">
          <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Daily Rundown planner</h2>
          <RundownCard overview={rundown} defaultSignIn={process.env.OWNER_EMAIL ?? ""} />
        </div>
      )}

      {isOwner && (
        <div className="flex flex-col gap-3 rounded-xl border border-white/8 p-4">
          <h2 className="text-xs font-bold uppercase tracking-wide text-g300">Job logs</h2>
          <p className={subTextClass}>
            Each job keeps a log file in its address folder (Teams Job Notes, Files), rewritten whenever
            something happens on the job. This writes the file for older jobs, 10 per press. No money
            amounts go in it, since techs can open those folders.
          </p>
          <RebuildJobLogsButton />
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
