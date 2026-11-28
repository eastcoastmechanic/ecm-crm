-- 0087: daily rundown from Grok, and the owner-only "ECM Daily Rundown" Planner plan.
--
-- POST /api/rundown (a bot key from /account) stores one row per run in rundown_runs and
-- one row per item in rundown_items. The same key from the same bot updates the same row
-- (and the same Planner card); nothing is deleted. rundown_planner holds the ids of the
-- private Microsoft 365 group, plan and buckets made by the button on /account.
--
-- Money flags live here, so: RLS on, no policies, no anon/authenticated access. Only the
-- server (service role) reads or writes these tables.
-- Additive and safe to re-run.

create table if not exists rundown_runs (
  id uuid primary key default gen_random_uuid(),
  bot text not null,
  run_date date not null,
  period_from timestamptz,
  period_to timestamptz,
  summary text,
  item_count integer not null default 0,
  raw jsonb not null,
  received_at timestamptz not null default now()
);

create index if not exists rundown_runs_bot_received_idx on rundown_runs (bot, received_at desc);

create table if not exists rundown_items (
  id uuid primary key default gen_random_uuid(),
  bot text not null,
  key text not null,
  section text not null check (section in ('happened', 'money', 'waiting', 'next', 'conflict')),
  title text not null,
  detail text,
  due date,
  priority text not null default 'normal' check (priority in ('urgent', 'important', 'normal')),
  source text,
  job_id uuid references jobs (id) on delete set null,
  lead_id uuid references leads (id) on delete set null,
  customer_id uuid references customers (id) on delete set null,
  -- { "customer_id": uuid, "body": text }. Sent later only by Josh completing the card.
  text_draft jsonb,
  status text not null default 'open' check (status in ('open', 'done', 'dropped')),
  first_run_date date not null,
  last_run_date date not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_run_id uuid references rundown_runs (id) on delete set null,
  done_at timestamptz,
  -- Planner user id when Josh completed the card, 'bot:<name>' for closed_keys, 'auto' for old What happened cards.
  done_by text,
  done_source text check (done_source in ('planner', 'grok', 'auto')),
  planner_task_id text,
  -- What the CRM last wrote to the card (title, bucket, due, labels, description hash, complete).
  planner_pushed jsonb,
  needs_push boolean not null default true,
  push_error text,
  push_attempts integer not null default 0,
  pushed_at timestamptz,
  -- For the later "Texts to approve" step: when the text went out through Quo.
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (bot, key)
);

create index if not exists rundown_items_needs_push_idx on rundown_items (needs_push) where needs_push;
create index if not exists rundown_items_open_idx on rundown_items (bot, status, section);
create unique index if not exists rundown_items_planner_task_key on rundown_items (planner_task_id)
  where planner_task_id is not null;

create table if not exists rundown_planner (
  id smallint primary key default 1 check (id = 1),
  owner_user_id text,
  group_id text,
  plan_id text,
  -- { "waiting": "<bucket id>", "texts": ..., "money": ..., "next": ..., "conflict": ..., "happened": ... }
  buckets jsonb,
  labels_set boolean not null default false,
  last_pull_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table rundown_runs enable row level security;
alter table rundown_items enable row level security;
alter table rundown_planner enable row level security;
revoke all on rundown_runs, rundown_items, rundown_planner from anon, authenticated;

-- Check: one row, all true.
select
  to_regclass('public.rundown_runs') is not null as runs_ready,
  to_regclass('public.rundown_items') is not null as items_ready,
  to_regclass('public.rundown_planner') is not null as planner_ready,
  (select bool_and(relrowsecurity) from pg_class
     where oid in ('public.rundown_runs'::regclass, 'public.rundown_items'::regclass, 'public.rundown_planner'::regclass)) as rls_on;
