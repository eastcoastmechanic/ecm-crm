-- Recurring maintenance visits for service plans (Phase 3, issue #60).
--
-- A plan promises visits; this records them so none is guessed or forgotten.
--   service_contracts.visits_per_year / visit_months : which months of the year a visit is due
--     (calendar months 1-12, for example {4,10} = April AC tune-up and October heating tune-up).
--     Null means "no visit schedule": the cron skips that plan and invents nothing.
--   maintenance_visits : one row per plan per due month. The daily cron creates the row and an
--     unscheduled job (job_type 'maintenance') for it. The unique key makes a repeat run a no-op.
--   booking_reminder_sent_at / followup_reminder_sent_at : used by the customer booking reminder
--     (next PR); added now so there is only one SQL file to run.
--
-- Additive. Existing plans are untouched (the live database has none).
-- Internal only: RLS on with no anon policy; the server uses the service role.

alter table service_contracts
  add column if not exists visits_per_year integer,
  add column if not exists visit_months integer[];

alter table service_contracts drop constraint if exists service_contracts_visits_per_year_check;
alter table service_contracts add constraint service_contracts_visits_per_year_check
  check (visits_per_year is null or visits_per_year between 1 and 12);

alter table service_contracts drop constraint if exists service_contracts_visit_months_check;
alter table service_contracts add constraint service_contracts_visit_months_check
  check (visit_months is null or (cardinality(visit_months) between 1 and 12 and visit_months <@ array[1,2,3,4,5,6,7,8,9,10,11,12]));

create table if not exists maintenance_visits (
  id uuid primary key default gen_random_uuid(),
  service_contract_id uuid not null references service_contracts(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  property_id uuid references properties(id) on delete set null,
  due_year integer not null,
  due_month integer not null check (due_month between 1 and 12),
  label text,
  status text not null default 'due' check (status in ('due', 'complete', 'skipped')),
  job_id uuid references jobs(id) on delete set null,
  booking_reminder_sent_at timestamptz,
  followup_reminder_sent_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (service_contract_id, due_year, due_month)
);

create index if not exists maintenance_visits_open_idx on maintenance_visits (due_year, due_month) where status = 'due';
create index if not exists maintenance_visits_job_idx on maintenance_visits (job_id) where job_id is not null;

alter table maintenance_visits enable row level security;
