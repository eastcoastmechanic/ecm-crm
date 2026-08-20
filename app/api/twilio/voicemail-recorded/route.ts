import { NextResponse } from "next/server";
import twilio from "twilio";
import { createPlannerTask } from "@/lib/planner-connector";

// Twilio's recordingStatusCallback for the known-customer voicemail path
// (see app/api/twilio/voice/route.ts). Caller identity is passed through as
// query params on the callback URL rather than re-looked-up here -- the
// voice route already had the match in hand when it built the <Record>
// TwiML, and Twilio echoes callback query strings back untouched.
export async function POST(request: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const signature = request.headers.get("X-Twilio-Signature");
  const url = request.url;

  const formData = await request.formData();
  const params: Record<string, string> = {};
  formData.forEach((value, key) => {
    params[key] = String(value);
  });

  if (!authToken || !signature || !twilio.validateRequest(authToken, signature, url, params)) {
    return NextResponse.json({ error: "Invalid Twilio signature" }, { status: 401 });
  }

  if (params.RecordingStatus !== "completed" || !params.RecordingSid) {
    return NextResponse.json({ ok: true });
  }

  const requestUrl = new URL(request.url);
  const from = requestUrl.searchParams.get("from") ?? params.From ?? "unknown number";
  const customerName = requestUrl.searchParams.get("customerName");

  const playbackUrl = `${requestUrl.origin}/api/twilio/recordings/${params.RecordingSid}`;
  const durationSec = params.RecordingDuration ? `${params.RecordingDuration}s` : "unknown length";

  await createPlannerTask({
    title: `Voicemail from ${customerName ?? from}`,
    notes: `${from} left a ${durationSec} voicemail. Listen: ${playbackUrl}`,
    bucket: "tasks",
  });

  return NextResponse.json({ ok: true });
}
