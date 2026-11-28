"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/require-role";
import { setupRundownPlanner, syncRundownPlanner } from "@/lib/rundown-planner";

export type RundownActionState = { error?: string; message?: string; signIn?: string } | null;

/** Owner-only. Makes the private group and the ECM Daily Rundown plan (safe to press again). */
export async function createRundownPlanner(_prev: RundownActionState, formData: FormData): Promise<RundownActionState> {
  try {
    await requireOwner();
  } catch {
    return { error: "Only the owner can do this." };
  }
  const signIn = String(formData.get("sign_in") ?? "").trim();
  const result = await setupRundownPlanner(signIn);
  revalidatePath("/account");
  return result.ok ? { message: result.message, signIn } : { error: result.error, signIn };
}

/** Owner-only. Reads completions back from Planner and writes any waiting cards now. */
export async function syncRundownNow(): Promise<RundownActionState> {
  try {
    await requireOwner();
  } catch {
    return { error: "Only the owner can do this." };
  }
  const summary = await syncRundownPlanner();
  revalidatePath("/account");
  if (!summary.configured) return { error: "The planner isn't set up yet." };
  const pulled = summary.pulled ? `${summary.pulled.done} done, ${summary.pulled.dropped} removed. ` : "Couldn't read Planner. ";
  return {
    message: `${pulled}${summary.pushed} card(s) written${summary.failed ? `, ${summary.failed} failed (retries hourly)` : ""}${summary.remaining ? ", more waiting" : ""}.`,
  };
}
