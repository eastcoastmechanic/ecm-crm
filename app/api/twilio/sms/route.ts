import { NextResponse } from "next/server";
import twilio from "twilio";
import { respondToSms } from "@/lib/receptionist/sms-agent";

function toTwiML(message: string) {
  const escaped = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`;
}

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

  const from = params.From;
  const body = params.Body ?? "";

  if (!from) {
    return new NextResponse(toTwiML(""), { headers: { "Content-Type": "text/xml" } });
  }

  const reply = await respondToSms({ fromPhone: from, body });

  return new NextResponse(toTwiML(reply), { headers: { "Content-Type": "text/xml" } });
}
