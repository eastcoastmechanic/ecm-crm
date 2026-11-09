-- Time edits: the office fixes, adds and voids clocked time on /hours, and pauses or resumes a
-- tech's job timer from /jobs. Every change is written to time_edits (who, when, why, before and
-- after), so payroll changes are never silent.
--
--   time_edits                 : one row per office change. before/after are the row's time
--                                fields as JSON (null before for 'add').
--   voided_at / voided_reason  : a voided shift or job timer stays in the table (greyed on /hours)
--                                but is left out of payroll, the Gusto file, week totals,
--                                Reports and jobs.tracked_hours.
--
-- Additive and safe to re-run. No existing data is changed or deleted.
-- The app works before this runs: edits still save (the audit row is skipped and logged), and
-- Void answers "Run SQL 0078 to void entries".
-- Internal only: RLS on with no policies; the server uses the service role (same as 0055).

create table if not exists time_edits (
  id uuid primary key default gen_random_uuid(),
  table_name text not null check (table_name in ('time_shifts', 'job_time_entries')),
  row_id uuid not null,
  action text not null check (action in ('edit', 'add', 'void', 'pause', 'resume')),
  before jsonb,
  after jsonb,
  reason text,
  edited_by uuid references staff(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists time_edits_row_idx on time_edits (table_name, row_id, created_at desc);

alter table time_shifts add column if not exists voided_at timestamptz;
alter table time_shifts add column if not exists voided_reason text;
alter table job_time_entries add column if not exists voided_at timestamptz;
alter table job_time_entries add column if not exists voided_reason text;

alter table time_edits enable row level security;
revoke all on time_edits from anon, authenticated;
revoke all on time_shifts from anon, authenticated;
revoke all on job_time_entries from anon, authenticated;

-- Check: one row, all true.
select
  to_regclass('public.time_edits') is not null as time_edits_exists,
  coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.time_edits')), false) as rls_on,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'time_shifts' and column_name = 'voided_at'
  ) as shifts_void_column,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'job_time_entries' and column_name = 'voided_at'
  ) as entries_void_column;
