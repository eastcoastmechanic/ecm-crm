import { NextResponse } from "next/server";
import twilio from "twilio";
import { supabase } from "@/lib/supabase";
import { greetCaller, respondToCall } from "@/lib/receptionist/voice-agent";

function toVoiceTwiML(sayText: string) {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  const gather = twiml.gather({
    input: ["speech"],
    action: "/api/twilio/voice",
    method: "POST",
    speechTimeout: "auto",
    speechModel: "phone_call",
  });
  gather.say(sayText);

  twiml.say("Sorry, I didn't catch that. Please call back if you still need help. Goodbye.");
  twiml.hangup();

  return twiml.toString();
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

  const callSid = params.CallSid;
  const from = params.From;
  const speechResult = params.SpeechResult?.trim();

  if (!callSid || !from) {
    return new NextResponse(toVoiceTwiML("Sorry, something went wrong on our end. Goodbye."), {
      headers: { "Content-Type": "text/xml" },
    });
  }

  const { data: existing } = await supabase
    .from("ai_conversations")
    .select("id")
    .eq("call_sid", callSid)
    .maybeSingle();

  let reply: string;
  if (!existing) {
    reply = await greetCaller({ callSid, fromPhone: from });
  } else if (speechResult) {
    reply = await respondToCall({ callSid, fromPhone: from, speechResult });
  } else {
    reply = "Sorry, could you say that again?";
  }

  return new NextResponse(toVoiceTwiML(reply), { headers: { "Content-Type": "text/xml" } });
}
