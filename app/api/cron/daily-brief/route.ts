import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { etHour } from "@/lib/tz";
import { loadDailyBrief, formatOwnerBrief, formatTechBrief } from "@/lib/daily-brief";
import { claimBriefPost, releaseBriefPost } from "@/lib/daily-brief-guard";
import { postToTeams, teamsConfigured, type TeamsChannel } from "@/lib/teams";

const BRIEF_HOUR_ET = 7;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://ecm-crm.vercel.app";

// Morning brief to Teams. The owner card (jobs, what needs a decision, money) goes
// to the owner-only "brief" channel. A jobs-only card with no money goes to dispatch,
// which techs can read. vercel.json runs this at 11:00 and 12:00 UTC so one run lands
// on 7:00 New York time in both EDT and EST; the other exits. A channel with no
// webhook set is skipped. Each channel is claimed for the day before posting
// (lib/daily-brief-guard.ts), so a cron retry can't post twice.
// ?force=1 skips the hour check and the claim for a manual test run.
export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const force = new URL(request.url).searchParams.get("force") === "1";
  if (!force && etHour() !== BRIEF_HOUR_ET) {
    return NextResponse.json({ posted: [], skipped: "not 7am in New York" });
  }

  const brief = await loadDailyBrief();
  const posted: string[] = [];
  const failed: string[] = [];
  const alreadyPosted: string[] = [];

  const cards: { channel: TeamsChannel; card: { title: string; text: string }; url: string }[] = [
    { channel: "brief", card: formatOwnerBrief(brief), url: `${APP_URL}/dashboard` },
    { channel: "dispatch", card: formatTechBrief(brief), url: `${APP_URL}/field-board` },
  ];

  for (const { channel, card, url } of cards) {
    if (!teamsConfigured(channel)) continue;
    const claim = force ? "unguarded" : await claimBriefPost(brief.dateKey, channel);
    if (claim === "already_posted") {
      alreadyPosted.push(channel);
      continue;
    }
    const ok = await postToTeams(channel, { ...card, url });
    if (ok) posted.push(channel);
    else {
      failed.push(channel);
      if (claim === "claimed") await releaseBriefPost(brief.dateKey, channel);
    }
  }

  return NextResponse.json({ posted, failed, alreadyPosted });
}
