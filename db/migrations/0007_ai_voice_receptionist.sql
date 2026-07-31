-- Phase: AI voice receptionist. Extends ai_conversations (built for SMS) to
-- also track voice calls, keyed by Twilio's CallSid rather than an
-- open/closed phone thread, since a call is a single bounded session.

alter table ai_conversations add column if not exists call_sid text;

create unique index if not exists ai_conversations_call_sid_idx
  on ai_conversations(call_sid) where call_sid is not null;
