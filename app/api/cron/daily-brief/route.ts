import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { etHour } from "@/lib/tz";
import { loadDailyBrief, formatOwnerBrief, formatTechBrief } from "@/lib/daily-brief";
import { postToTeams, teamsConfigured } from "@/lib/teams";

const BRIEF_HOUR_ET = 7;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://ecm-crm.vercel.app";

// Morning brief to Teams. The owner card (jobs, what needs a decision, money) goes
// to the owner-only "brief" channel. A jobs-only card with no money goes to dispatch,
// which techs can read. vercel.json runs this at 11:00 and 12:00 UTC so one run lands
// on 7:00 New York time in both EDT and EST; the other exits. A channel with no
// webhook set is skipped. ?force=1 skips the hour check for a manual test run.
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

  const owner = formatOwnerBrief(brief);
  if (teamsConfigured("brief")) {
    const ok = await postToTeams("brief", { ...owner, url: `${APP_URL}/dashboard` });
    (ok ? posted : failed).push("brief");
  }

  const tech = formatTechBrief(brief);
  if (teamsConfigured("dispatch")) {
    const ok = await postToTeams("dispatch", { ...tech, url: `${APP_URL}/field-board` });
    (ok ? posted : failed).push("dispatch");
  }

  return NextResponse.json({ posted, failed });
}
