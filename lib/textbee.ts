import { toE164 } from "@/lib/phone";

const TEXTBEE_BASE_URL = "https://api.textbee.dev/api/v1";
const TEXTBEE_API_KEY = process.env.TEXTBEE_API_KEY;
const TEXTBEE_DEVICE_ID = process.env.TEXTBEE_DEVICE_ID;

// Sends from whatever number is on the SIM in the Android device running the
// TextBee app -- unlike InfiniReach there's no separate "from" number to
// configure, the device's own line is the identity.
export async function sendTextBeeSms(to: string, body: string) {
  if (!TEXTBEE_API_KEY) {
    console.log(`[sms skipped, TextBee not configured] to=${to}: ${body}`);
    return;
  }

  const res = await fetch(`${TEXTBEE_BASE_URL}/gateway/send-sms`, {
    method: "POST",
    headers: {
      "x-api-key": TEXTBEE_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      recipients: [toE164(to)],
      message: body,
      ...(TEXTBEE_DEVICE_ID ? { deviceId: TEXTBEE_DEVICE_ID } : {}),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`TextBee SMS send failed (${res.status}): ${text}`);
  }
}
