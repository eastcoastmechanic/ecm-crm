-- Numbers the AI SMS receptionist should never auto-respond to (e.g.
-- contractors/subs who text the business line for non-customer reasons).
-- Checked by phone number in the inbound webhook before invoking the AI.

create table if not exists sms_excluded_numbers (
  id uuid primary key default gen_random_uuid(),
  phone_number text not null unique,
  label text,
  created_at timestamptz not null default now()
);

alter table sms_excluded_numbers enable row level security;
create policy "internal full access" on sms_excluded_numbers for all to anon using (true) with check (true);
