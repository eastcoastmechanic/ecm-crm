import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { sendTextBeeSms } from "@/lib/textbee";
import { respondToSms } from "@/lib/receptionist/sms-agent";
import { findCustomerByPhone } from "@/lib/receptionist/customer-lookup";

// TextBee bridges Josh's real number (774-343-6369) into the CRM -- an
// Android phone running the TextBee app holds that line's SIM and relays
// inbound texts here. Known customers get no AI reply: Josh already sees
// the text natively on that phone and answers personally, same policy
// Josh chose for missed calls forwarded from this number. Only texts from
// numbers not in `customers` get the AI receptionist (lib/receptionist/sms-agent.ts,
// the same one already answering the AI-only number via InfiniReach).
//
// textbee's docs show two different payload shapes for MESSAGE_RECEIVED
// (a flat one and a {event,data} envelope) -- this handler accepts either
// until confirmed live which one actually arrives.
type TextBeePayload = {
  event?: string;
  webhookEvent?: string;
  data?: { sender?: string; message?: string };
  sender?: string;
  message?: string;
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
  const secret = process.env.TEXTBEE_WEBHOOK_SECRET;
  const signature = request.headers.get("x-signature");
  const rawBody = await request.text();

  if (!secret || !isValidSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: TextBeePayload;
  try {
    payload = JSON.parse(rawBody) as TextBeePayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = payload.event ?? payload.webhookEvent;
  if (eventType !== "MESSAGE_RECEIVED") {
    return NextResponse.json({ ok: true });
  }

  const from = payload.data?.sender ?? payload.sender;
  const body = payload.data?.message ?? payload.message ?? "";
  if (!from) {
    return NextResponse.json({ ok: true });
  }

  const matchedCustomer = await findCustomerByPhone(from);
  if (matchedCustomer) {
    return NextResponse.json({ ok: true, knownCustomer: true });
  }

  const reply = await respondToSms({ fromPhone: from, body });
  await sendTextBeeSms(from, reply);

  return NextResponse.json({ ok: true });
}
