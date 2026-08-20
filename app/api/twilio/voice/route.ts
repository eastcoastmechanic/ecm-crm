import { NextResponse } from "next/server";
import twilio from "twilio";
import { supabase } from "@/lib/supabase";
import { greetCaller, respondToCall } from "@/lib/receptionist/voice-agent";
import { findCustomerByPhone } from "@/lib/receptionist/customer-lookup";

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

// Josh's real line (774-343-6369) conditionally forwards missed calls to
// this same AI number -- Twilio surfaces that as a ForwardedFrom param.
// Known customers get a plain voicemail instead of the AI: Josh already has
// a relationship with them and would rather call back personally than have
// the AI attempt to handle it. Unknown/new numbers still fall through to
// the normal AI flow below, same as a call dialed to the AI number directly.
function toVoicemailTwiML(customerName: string, from: string) {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  twiml.say(`Sorry we missed you! Please leave a message after the tone and we'll get back to you soon.`);
  twiml.record({
    maxLength: 120,
    playBeep: true,
    recordingStatusCallback: `/api/twilio/voicemail-recorded?from=${encodeURIComponent(from)}&customerName=${encodeURIComponent(customerName)}`,
    recordingStatusCallbackMethod: "POST",
  });
  twiml.say("We didn't receive a recording. Goodbye.");
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

  if (params.ForwardedFrom) {
    const matchedCustomer = await findCustomerByPhone(from);
    if (matchedCustomer) {
      return new NextResponse(toVoicemailTwiML(matchedCustomer.name, from), {
        headers: { "Content-Type": "text/xml" },
      });
    }
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
