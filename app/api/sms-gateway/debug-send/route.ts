import { NextResponse } from "next/server";

// TEMPORARY — remove once the InfiniReach "from" format issue is resolved.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.SMS_GATEWAY_DEBUG_TOKEN}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.SMS_GATEWAY_API_KEY;
  const baseUrl = process.env.SMS_GATEWAY_BASE_URL || "https://api.infinireach.io";
  if (!apiKey) {
    return NextResponse.json({ error: "no api key configured" }, { status: 500 });
  }

  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "+15551234567";

  const body: Record<string, string> = { message: "debug test", to, channel: "sms" };
  if (from) body.from = from;

  const res = await fetch(`${baseUrl}/api/v1/messages`, {
    method: "POST",
    headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  return NextResponse.json({ sentBody: body, status: res.status, response: text });
}
