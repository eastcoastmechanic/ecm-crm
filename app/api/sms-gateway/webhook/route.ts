import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { sendSMS } from "@/lib/sms";
import { respondToSms } from "@/lib/receptionist/sms-agent";

type InfiniReachWebhookPayload = {
  event: string;
  data: {
    from?: string;
    to?: string;
    body?: string;
  };
};

// InfiniReach signs JSON.stringify(payload.data) only, not the full envelope
// (event/timestamp wrapper) — confirmed empirically against real deliveries.
function isValidSignature(dataString: string, signature: string | null, secret: string) {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(dataString).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const signatureBuf = Buffer.from(signature, "utf8");
  if (expectedBuf.length !== signatureBuf.length) return false;
  return timingSafeEqual(expectedBuf, signatureBuf);
}

export async function POST(request: Request) {
  const secret = process.env.SMS_GATEWAY_WEBHOOK_SECRET;
  const signature = request.headers.get("X-Webhook-Signature");
  const rawBody = await request.text();

  let event: InfiniReachWebhookPayload;
  try {
    event = JSON.parse(rawBody) as InfiniReachWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const dataString = JSON.stringify(event.data);
  if (!secret || !isValidSignature(dataString, signature, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  if (event.event !== "message.inbound") {
    return NextResponse.json({ ok: true });
  }

  const from = event.data.from;
  const body = event.data.body ?? "";
  if (!from) {
    return NextResponse.json({ ok: true });
  }

  const reply = await respondToSms({ fromPhone: from, body });
  await sendSMS(from, reply);

  return NextResponse.json({ ok: true });
}
