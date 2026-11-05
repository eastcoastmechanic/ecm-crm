-- Generic job checklist with a finish gate (plan v3, Phase 1).
--
--   job_checklist_templates : the default list a job gets, by job_type. job_type 'default' is the
--                             fallback for any type that has no list of its own. Edit these rows
--                             (labels, order, required) to change what future jobs get.
--   job_checklist_items     : the copy a job gets the first time the truck screen loads it, so a later
--                             template edit never changes a job already in progress.
--   job_checklist_unlocks   : owner unlock when a tech is stuck (broken phone, customer will not wait).
--                             Always carries who and why. An unlock lets that job be finished.
--
-- A tech cannot finish a job while a required item is open or the job has no photo, unless the job
-- has an unlock. Office and owner finishing from the Jobs page are not gated.
--
-- The starter list below is plain placeholder wording, NOT taken from your business. Edit it.
-- Additive. Existing jobs get their list the next time the truck screen loads them.
-- Internal only: RLS on with no anon policy; the server uses the service role.

create table if not exists job_checklist_templates (
  id uuid primary key default gen_random_uuid(),
  job_type text not null default 'default',
  position integer not null,
  label text not null,
  required boolean not null default true,
  created_at timestamptz not null default now(),
  unique (job_type, position)
);

create table if not exists job_checklist_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  position integer not null,
  label text not null,
  required boolean not null default true,
  done_at timestamptz,
  done_by uuid references staff(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (job_id, position)
);

create index if not exists job_checklist_items_job_idx on job_checklist_items (job_id);

create table if not exists job_checklist_unlocks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  unlocked_by uuid references staff(id) on delete set null,
  unlocked_by_role text not null,
  reason text not null check (char_length(btrim(reason)) >= 5),
  created_at timestamptz not null default now()
);

create index if not exists job_checklist_unlocks_job_idx on job_checklist_unlocks (job_id);

alter table job_checklist_templates enable row level security;
alter table job_checklist_items enable row level security;
alter table job_checklist_unlocks enable row level security;

insert into job_checklist_templates (job_type, position, label, required) values
  ('default', 1, 'Checked in with the customer and confirmed the work', true),
  ('default', 2, 'Protected the work area', true),
  ('default', 3, 'Work finished and tested, system running right', true),
  ('default', 4, 'Cleaned up the work area', true),
  ('default', 5, 'Walked the customer through what was done', true),
  ('default', 6, 'Notes added for anything the office needs to know', true)
on conflict (job_type, position) do nothing;
