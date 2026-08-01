const INFINIREACH_BASE_URL = process.env.SMS_GATEWAY_BASE_URL || "https://api.infinireach.io";
const INFINIREACH_API_KEY = process.env.SMS_GATEWAY_API_KEY;
const INFINIREACH_FROM_NUMBER = process.env.SMS_GATEWAY_FROM_NUMBER;

// Customer phone numbers are stored as free-text (e.g. "(774) 555-1234"), but
// InfiniReach requires E.164. Assumes US/+1 since the business only serves
// the Plymouth, MA area.
function toE164(raw: string) {
  if (raw.startsWith("+")) return raw;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return raw;
}

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
