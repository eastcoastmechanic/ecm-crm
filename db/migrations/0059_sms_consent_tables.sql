-- 0059: make the live SMS consent tables match lib/sms-consent.ts
--
-- Why: 0042 used "create table if not exists", and an older sms_optins table
-- (id, name, phone, consented_at) already existed, so 0042 did nothing. 0018
-- (sms_excluded_numbers) never ran at all. Without these tables every STOP
-- text fails on its first write and the consent check refuses to text anyone.
--
-- Checked before writing this: sms_optins has 0 rows, so recreating it loses
-- nothing. The block below stops with an error if that is no longer true.
-- No anon policies: the app reads and writes these with the service role.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sms_optins' and column_name = 'consented_at'
  ) then
    if exists (select 1 from sms_optins limit 1) then
      raise exception 'sms_optins has rows. Stop and tell Claude before dropping it.';
    end if;
    drop table sms_optins;
  end if;
end $$;

create table if not exists sms_optins (
  phone_key text primary key,
  phone text not null,
  name text,
  status text not null check (status in ('pending', 'opted_in', 'opted_out')),
  requested_at timestamptz not null default now(),
  confirmed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists sms_excluded_numbers (
  id uuid primary key default gen_random_uuid(),
  phone_number text not null unique,
  label text,
  created_at timestamptz not null default now()
);

alter table sms_optins enable row level security;
alter table sms_excluded_numbers enable row level security;
revoke all on sms_optins from anon, authenticated;
revoke all on sms_excluded_numbers from anon, authenticated;
