-- Website chatbot (public marketing site). ai_conversations previously only
-- served the SMS/voice receptionist, where phone_number is always known.
-- A web visitor has no phone number until/unless they give one while
-- booking, so their thread is keyed by a client-generated session id instead.

alter table ai_conversations alter column phone_number drop not null;
alter table ai_conversations add column session_id text;

create unique index ai_conversations_session_idx on ai_conversations(session_id) where session_id is not null;
