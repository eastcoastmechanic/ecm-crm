"use server";

import { createPortalServerClient } from "@/lib/supabase-portal/server";
import { requireOwner } from "@/lib/require-role";
import { postToTeams, teamsConfigured, type TeamsChannel } from "@/lib/teams";
import { disconnect } from "@/lib/microsoft-delegated";
import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { getMyStaffId } from "@/lib/job-access";
import { BOT_NAME_PATTERN, newBotKey } from "@/lib/bot-keys";

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

/** Owner-only. Forgets the saved Microsoft sign-in for OneNote. Notes keep saving in the CRM. */
export async function disconnectOneNote(): Promise<{ error?: string }> {
  try {
    await requireOwner();
  } catch {
    return { error: "Only the owner can do this." };
  }
  await disconnect();
  revalidatePath("/account");
  return {};
}

export type BotKeyState = { error?: string; name?: string; created?: { name: string; key: string } } | null;

/** Owner-only. Makes a key for one bot. The key is returned once and only its hash is stored. */
export async function createBotKey(_prev: BotKeyState, formData: FormData): Promise<BotKeyState> {
  try {
    await requireOwner();
  } catch {
    return { error: "Only the owner can do this." };
  }
  const name = String(formData.get("name") ?? "").trim().toLowerCase();
  if (!BOT_NAME_PATTERN.test(name)) {
    return { error: "Name: 2 to 40 letters, numbers or dashes, like quo or field-board.", name };
  }
  const { key, hash, hint } = newBotKey();
  const { error } = await supabase.from("bot_keys").insert({
    name,
    token_hash: hash,
    token_hint: hint,
    created_by: await getMyStaffId(),
  });
  if (error) {
    if (error.code === "23505") return { error: `${name} already has a live key. Revoke it first.`, name };
    if (error.code === "42P01") return { error: "The bot_keys table isn't there yet. Run SQL 0068 first.", name };
    return { error: "Couldn't save the key. Try again.", name };
  }
  revalidatePath("/account");
  return { created: { name, key } };
}

/** Owner-only. Cuts one bot off. Its old posts stay. */
export async function revokeBotKey(_prev: BotKeyState, formData: FormData): Promise<BotKeyState> {
  try {
    await requireOwner();
  } catch {
    return { error: "Only the owner can do this." };
  }
  const id = String(formData.get("id") ?? "");
  const { error } = await supabase
    .from("bot_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .is("revoked_at", null);
  if (error) return { error: "Couldn't revoke the key. Try again." };
  revalidatePath("/account");
  return {};
}
