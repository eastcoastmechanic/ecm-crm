-- Explicit SMS opt-in / opt-out records keyed by phone number (last 10 digits),
-- independent of the customers table. Used for:
--   * double opt-in from /sms-signup (status 'pending' until the person replies YES)
--   * STOP / START keyword replies from numbers that are not customers
--   * deciding whether a lead with no customer record may be texted
-- Customers keep using customers.sms_consent; the inbound keyword handler
-- writes both.

create table if not exists sms_optins (
  phone_key text primary key,
  phone text not null,
  name text,
  status text not null check (status in ('pending', 'opted_in', 'opted_out')),
  requested_at timestamptz not null default now(),
  confirmed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table sms_optins enable row level security;
create policy "internal full access" on sms_optins for all to anon using (true) with check (true);
