-- Phase: AI SMS receptionist (v1, texting only). Customers can text the
-- business number; Claude answers questions and can propose new/rescheduled
-- jobs (status 'requested', pending owner confirmation via the Jobs list).

alter table jobs add column if not exists created_via text not null default 'manual';

create table if not exists ai_conversations (
  id uuid primary key default gen_random_uuid(),
  channel text not null default 'sms',
  phone_number text not null,
  customer_id uuid references customers(id),
  status text not null default 'open',
  transcript jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_conversations_phone_idx on ai_conversations(phone_number);

alter table ai_conversations enable row level security;
create policy "internal full access" on ai_conversations for all to anon using (true) with check (true);
