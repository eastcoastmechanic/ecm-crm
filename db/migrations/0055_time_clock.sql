-- Time clock (plan v3, Phase 1): a full-day shift per person, plus time on each job.
--
--   time_shifts      : one row per clock in / clock out for the day. Feeds payroll (the weekly
--                      hours file for Gusto). break_minutes is the unpaid meal break.
--   job_time_entries : time on a job. kind 'drive' (On my way to Arrived) or 'work' (Arrived to
--                      Finish, minus pauses). Several rows per job: second visits, several techs,
--                      pause and resume. jobs.tracked_hours becomes the sum of 'work' entries.
--
-- A stop that was forgotten is closed by a daily cleanup at a cap and flagged for office review
-- (flagged / flag_reason / auto_closed), instead of silently producing a wrong number.
-- One open shift and one open job entry per person at a time (partial unique indexes).
--
-- Additive. Existing jobs keep their tracked_hours until a job has entries.
-- Internal only: RLS on with no anon policy; the server uses the service role.

create table if not exists time_shifts (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff(id) on delete restrict,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  break_minutes integer not null default 0 check (break_minutes between 0 and 480),
  note text,
  source text not null default 'app' check (source in ('app', 'auto', 'office')),
  flagged boolean not null default false,
  flag_reason text,
  auto_closed boolean not null default false,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);

create unique index if not exists time_shifts_one_open_idx on time_shifts (staff_id) where ended_at is null;
create index if not exists time_shifts_staff_started_idx on time_shifts (staff_id, started_at desc);
create index if not exists time_shifts_flagged_idx on time_shifts (started_at desc) where flagged and reviewed_at is null;

create table if not exists job_time_entries (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  staff_id uuid not null references staff(id) on delete restrict,
  shift_id uuid references time_shifts(id) on delete set null,
  kind text not null check (kind in ('work', 'drive')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  note text,
  source text not null default 'app' check (source in ('app', 'auto', 'office')),
  flagged boolean not null default false,
  flag_reason text,
  auto_closed boolean not null default false,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);

create unique index if not exists job_time_entries_one_open_idx on job_time_entries (staff_id) where ended_at is null;
create index if not exists job_time_entries_job_idx on job_time_entries (job_id);
create index if not exists job_time_entries_staff_started_idx on job_time_entries (staff_id, started_at desc);
create index if not exists job_time_entries_flagged_idx on job_time_entries (started_at desc) where flagged and reviewed_at is null;

alter table time_shifts enable row level security;
alter table job_time_entries enable row level security;
