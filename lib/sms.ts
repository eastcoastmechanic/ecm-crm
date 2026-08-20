import { toE164 } from "@/lib/phone";

const INFINIREACH_BASE_URL = process.env.SMS_GATEWAY_BASE_URL || "https://api.infinireach.io";
const INFINIREACH_API_KEY = process.env.SMS_GATEWAY_API_KEY;
const INFINIREACH_FROM_NUMBER = process.env.SMS_GATEWAY_FROM_NUMBER;

export async function sendSMS(to: string | null | undefined, body: string) {
  if (!to) return;

  if (!INFINIREACH_API_KEY || !INFINIREACH_FROM_NUMBER) {
    console.log(`[sms skipped, InfiniReach not configured] to=${to}: ${body}`);
    return;
  }

  const res = await fetch(`${INFINIREACH_BASE_URL}/api/v1/messages`, {
    method: "POST",
    headers: {
      "X-API-Key": INFINIREACH_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: toE164(to),
      message: body,
      from: INFINIREACH_FROM_NUMBER,
      channel: "sms",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`InfiniReach SMS send failed (${res.status}): ${text}`);
  }
}
