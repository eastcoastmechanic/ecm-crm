-- Customer "book my visit" link (Phase 3, issue #61).
--
-- The booking reminder carries a link to /visit/<confirm_token>. The token is a random uuid,
-- one per visit, so the link cannot be guessed from a visit id and each visit has its own.
-- When the customer taps "Request a visit" the request is stored here and the owner is alerted.
-- Nothing is scheduled or changed automatically.
--   customer_request_at   : when they asked (null = not yet). Stops the follow-up reminder.
--   customer_request_note : optional days/times they gave, up to 500 characters.
--
-- Additive. maintenance_visits has no rows yet; existing rows would each get their own token.

alter table maintenance_visits
  add column if not exists confirm_token uuid not null default gen_random_uuid(),
  add column if not exists customer_request_at timestamptz,
  add column if not exists customer_request_note text;

alter table maintenance_visits drop constraint if exists maintenance_visits_request_note_check;
alter table maintenance_visits add constraint maintenance_visits_request_note_check
  check (customer_request_note is null or char_length(customer_request_note) <= 500);

create unique index if not exists maintenance_visits_confirm_token_idx on maintenance_visits (confirm_token);
