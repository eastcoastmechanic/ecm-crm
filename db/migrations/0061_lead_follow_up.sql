-- Lead follow-ups (issue #62, second half). Run in the Supabase SQL editor.
--
-- Each lead gets a short "next step" (what you're doing next: call back, send quote, site visit)
-- and the date to do it by. The Leads board shows both and flags follow-ups that are due.
--
-- Additive. Existing leads keep null, so nothing shows as due until you set a date.

alter table leads
  add column if not exists next_step text,
  add column if not exists follow_up_on date;

-- The board looks up open leads by follow-up date.
create index if not exists leads_follow_up_on_idx on leads (follow_up_on)
  where follow_up_on is not null;
