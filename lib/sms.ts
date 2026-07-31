const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;

export async function sendSMS(to: string | null | undefined, body: string) {
  if (!to) return;

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    console.log(`[sms skipped, Twilio not configured] to=${to}: ${body}`);
    return;
  }

  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
  const params = new URLSearchParams({ To: to, From: TWILIO_FROM_NUMBER, Body: body });

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    }
  );

  if (!res.ok) {
    const text = await res.text();
    console.error(`Twilio SMS failed (${res.status}): ${text}`);
  }
}
