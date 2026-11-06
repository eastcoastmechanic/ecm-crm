"use server";

import { supabase } from "@/lib/supabase";
import { requireRole } from "@/lib/require-role";
import { getMyStaffId } from "@/lib/job-access";
import { parseSubscription } from "@/lib/push-rules";

export type PushResult = { ok: true } | { ok: false; error: string };

/** Save this phone's push subscription for the signed-in person. Everyone with a staff row can. */
export async function savePushSubscription(raw: unknown, userAgent: string): Promise<PushResult> {
  await requireRole(["owner", "office", "tech"]);
  const staffId = await getMyStaffId();
  if (!staffId) return { ok: false, error: "Sign in with your own staff login to get alerts." };
  const sub = parseSubscription(raw);
  if (!sub) return { ok: false, error: "That phone sent a bad alert setup. Try again." };

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      staff_id: staffId,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
      user_agent: userAgent.slice(0, 300),
    },
    { onConflict: "endpoint" }
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Forget this phone. Only removes a row that belongs to the signed-in person. */
export async function removePushSubscription(endpoint: string): Promise<PushResult> {
  await requireRole(["owner", "office", "tech"]);
  const staffId = await getMyStaffId();
  if (!staffId) return { ok: false, error: "Sign in with your own staff login." };
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint).eq("staff_id", staffId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
