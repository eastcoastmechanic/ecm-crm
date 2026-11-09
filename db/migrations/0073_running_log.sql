-- 0073: running log (/log page).
--
--   log_entries : quick running notes filed under one section: texts, plans, jobs or vendors
--                 (shown as "Vendors / parts"). A Jobs entry can link a job, a Texts entry a
--                 customer. "Fold" sets folded = true and folded_at; it only tucks the entry
--                 under the section's Folded list. Nothing in the app deletes a log entry.
--
-- Run in Supabase AFTER the PR merges (the preview uses the live database too). Until it is
-- run, /log shows the owner a plain "Run SQL 0073" message and nothing else.
--
-- Additive and safe to re-run. No existing data is changed or deleted.
-- Internal only: RLS on with no policies; the server uses the service role (same as 0065).
-- Body length (5000 characters) is checked in the app; the check below only refuses blanks.

create table if not exists log_entries (
  id uuid primary key default gen_random_uuid(),
  section text not null check (section in ('texts', 'plans', 'jobs', 'vendors')),
  body text not null check (length(btrim(body)) > 0),
  job_id uuid references jobs(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,
  created_by uuid references staff(id) on delete set null,
  created_at timestamptz not null default now(),
  folded boolean not null default false,
  folded_at timestamptz
);

create index if not exists log_entries_section_created_at_idx
  on log_entries (section, created_at desc);
create index if not exists log_entries_job_id_idx
  on log_entries (job_id);

alter table log_entries enable row level security;
revoke all on log_entries from anon, authenticated;

-- Check: one row, table_exists = true and rls_on = true.
select
  to_regclass('public.log_entries') is not null as table_exists,
  coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.log_entries')), false) as rls_on;
