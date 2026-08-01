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

function isValidSignature(rawBody: string, signature: string | null, secret: string) {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const signatureBuf = Buffer.from(signature, "utf8");
  if (expectedBuf.length !== signatureBuf.length) return false;
  return timingSafeEqual(expectedBuf, signatureBuf);
}

export async function POST(request: Request) {
  const secret = process.env.SMS_GATEWAY_WEBHOOK_SECRET;
  const signature = request.headers.get("X-Webhook-Signature");
  const rawBody = await request.text();

  if (!secret || !isValidSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(rawBody) as InfiniReachWebhookPayload;
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
