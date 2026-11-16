import { supabase } from "@/lib/supabase";

/**
 * One morning brief per Teams channel per New York day (SQL 0085, teams_brief_posts).
 * Teams webhooks have no idempotency key, so a cron retry in the same hour would post
 * the same card twice. The run claims (day, channel) before posting; a failed post
 * gives the claim back so the next run can try again.
 */

export type ClaimResult = "claimed" | "already_posted" | "unguarded";

/** Postgres unique violation: someone already claimed this day and channel. */
const UNIQUE_VIOLATION = "23505";

/**
 * What a claim insert's error means. No error: we own it. A duplicate: skip the post.
 * Anything else (table not there before SQL 0085 runs, a DB hiccup): post anyway,
 * because a missed brief is worse than a rare double one.
 */
export function claimOutcome(error: { code?: string } | null): ClaimResult {
  if (!error) return "claimed";
  if (error.code === UNIQUE_VIOLATION) return "already_posted";
  return "unguarded";
}

export async function claimBriefPost(dateKey: string, channel: string): Promise<ClaimResult> {
  const { error } = await supabase.from("teams_brief_posts").insert({ date_key: dateKey, channel });
  const outcome = claimOutcome(error);
  if (outcome === "unguarded") console.error("[daily-brief] claim failed, posting without the guard:", error?.message);
  return outcome;
}

export async function releaseBriefPost(dateKey: string, channel: string): Promise<void> {
  const { error } = await supabase.from("teams_brief_posts").delete().eq("date_key", dateKey).eq("channel", channel);
  if (error) console.error("[daily-brief] could not release claim:", error.message);
}
