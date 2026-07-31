-- Phase 5 of the growth/ops feature batch: multi-user roles + referral
-- tracking. staff links a real Supabase Auth user to a role, for the new
-- /login page added alongside (not replacing) the existing shared
-- Basic-Auth gate — see middleware.ts comments for why both stay active.

create table staff (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id) unique,
  name text,
  email text not null,
  role text not null check (role in ('owner', 'office', 'tech')),
  created_at timestamptz not null default now()
);

alter table customers add column if not exists referred_by_customer_id uuid references customers(id);
alter table customers add column if not exists referral_reward_sent_at timestamptz;

-- Deliberately NOT given the usual "anon full access" policy every other
-- table gets — staff gates role-based access, so it should never be
-- writable via the public anon key. A logged-in user may only read their
-- own row (to check their own role); rows are provisioned manually via the
-- SQL editor (postgres role bypasses RLS) until a proper admin UI exists.
alter table staff enable row level security;
create policy staff_read_own_row on staff
  for select to authenticated
  using (auth_user_id = auth.uid());
