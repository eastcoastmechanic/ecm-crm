import webpush from "web-push";
import { supabase } from "@/lib/supabase";
import { buildPushPayload, isGoneStatus, type PushPayload } from "@/lib/push-rules";

let configured: boolean | null = null;

function configure(): boolean {
  if (configured !== null) return configured;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!pub || !priv || !subject) {
    configured = false;
    return false;
  }
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
  return true;
}

/**
 * Push a short alert to every phone this person turned alerts on for. Never throws.
 * Does nothing until the VAPID keys are set on Vercel. Subscriptions the push service
 * says are gone are deleted.
 */
export async function sendPushToStaff(staffId: string, input: PushPayload): Promise<void> {
  try {
    if (!configure()) return;
    const { data: subs, error } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("staff_id", staffId);
    if (error || !subs || subs.length === 0) return; // table missing (SQL not run) or no phones yet

    const payload = JSON.stringify(buildPushPayload(input));
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint as string, keys: { p256dh: s.p256dh as string, auth: s.auth as string } },
            payload,
            { TTL: 60 * 60 * 12, timeout: 8000 }
          );
          await supabase.from("push_subscriptions").update({ last_used_at: new Date().toISOString() }).eq("id", s.id);
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (isGoneStatus(status)) await supabase.from("push_subscriptions").delete().eq("id", s.id);
          else console.error(`[push] send failed (${status ?? "no status"})`);
        }
      })
    );
  } catch (err) {
    console.error("[push] failed:", err instanceof Error ? err.message : err);
  }
}
