import { supabase } from "@/lib/supabase";
import { notifyOwnerOfReferralReward } from "@/lib/notify-owner";

/**
 * Call after any document transitions to "paid". If the paying customer was
 * referred and this referral hasn't been flagged yet, notify the owner and
 * mark it — a real credit/discount is issued manually, not here.
 */
export async function flagReferralRewardIfEligible(customerId: string, documentType: string) {
  if (documentType !== "invoice") return;

  const { data: customer } = await supabase
    .from("customers")
    .select("id, name, referred_by_customer_id, referral_reward_sent_at, referred_by:referred_by_customer_id(id, name)")
    .eq("id", customerId)
    .single();

  if (!customer?.referred_by_customer_id || customer.referral_reward_sent_at) return;

  const referrer = customer.referred_by as unknown as { id: string; name: string } | null;
  if (!referrer) return;

  // Atomic guard: only the request that actually flips null -> timestamp
  // sends the notification, so concurrent webhook/manual updates can't
  // double-notify.
  const { data: updated } = await supabase
    .from("customers")
    .update({ referral_reward_sent_at: new Date().toISOString() })
    .eq("id", customerId)
    .is("referral_reward_sent_at", null)
    .select("id")
    .single();

  if (!updated) return;

  await notifyOwnerOfReferralReward({
    referrerName: referrer.name,
    referrerId: referrer.id,
    referredName: customer.name,
  });
}
