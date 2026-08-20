import { NextResponse } from "next/server";

// Twilio recording media URLs require account-credential Basic Auth to
// fetch -- a bare link in a Planner task would just prompt Josh to log
// into the Twilio console. This proxies the audio through our own
// credentialed server so the Planner card's link just plays.
export async function GET(_request: Request, { params }: { params: Promise<{ recordingSid: string }> }) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    return NextResponse.json({ error: "Twilio not configured" }, { status: 500 });
  }

  const { recordingSid } = await params;
  const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${recordingSid}.mp3`,
    { headers: { Authorization: `Basic ${basicAuth}` } }
  );

  if (!res.ok) {
    return NextResponse.json({ error: "Recording not found" }, { status: res.status });
  }

  return new NextResponse(res.body, {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=3600" },
  });
}
