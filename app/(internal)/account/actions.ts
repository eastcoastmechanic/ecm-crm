"use server";

import { createPortalServerClient } from "@/lib/supabase-portal/server";
import { requireOwner } from "@/lib/require-role";
import { postToTeams, teamsConfigured, type TeamsChannel } from "@/lib/teams";

export async function updatePassword(formData: FormData) {
  const password = formData.get("password") as string;
  const confirmPassword = formData.get("confirm_password") as string;

  if (!password || password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (password !== confirmPassword) {
    return { error: "Passwords don't match." };
  }

  const supabase = await createPortalServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "You need to be signed in to change your password." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };

  return { success: true };
}

const TEAMS_TEST_CHANNELS: { channel: TeamsChannel; label: string }[] = [
  { channel: "dispatch", label: "Dispatch" },
  { channel: "job_notes", label: "Job Notes" },
  { channel: "money", label: "Money Alerts" },
  { channel: "service_plans", label: "Service Plans" },
  { channel: "leads", label: "Leads" },
  { channel: "parts", label: "Parts & Inventory" },
  { channel: "reviews", label: "Reviews" },
  { channel: "general", label: "General" },
];

/**
 * Owner-only. Posts one clearly labelled test card to every Teams channel that
 * has a webhook set, each naming the channel it is meant for, so a webhook
 * pointed at the wrong channel is obvious before real alerts use it.
 */
export async function sendTeamsTest() {
  await requireOwner();
  const results: { label: string; status: "sent" | "failed" | "not set" }[] = [];
  for (const { channel, label } of TEAMS_TEST_CHANNELS) {
    if (!teamsConfigured(channel)) {
      results.push({ label, status: "not set" });
      continue;
    }
    const ok = await postToTeams(channel, {
      title: `ECM CRM test: this should be the ${label} channel`,
      text: `If you can read this in ${label}, the connection works. If it is in a different channel, tell Josh.`,
    });
    results.push({ label, status: ok ? "sent" : "failed" });
  }
  return { results };
}
