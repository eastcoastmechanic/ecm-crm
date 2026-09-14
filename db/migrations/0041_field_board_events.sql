-- Field Board / Grok bot events that land in the CRM hub.
-- Do not invent customers here. job_id is optional and nulls if the job is deleted.

create table if not exists field_board_events (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'field-board',
  title text not null,
  body text,
  board_status text,
  job_id uuid references jobs(id) on delete set null,
  external_ref text,
  created_at timestamptz not null default now()
);

create index if not exists field_board_events_created_at_idx
  on field_board_events (created_at desc);

create index if not exists field_board_events_job_id_idx
  on field_board_events (job_id);

alter table field_board_events enable row level security;

drop policy if exists "internal full access field board events" on field_board_events;
create policy "internal full access field board events"
  on field_board_events for all
  to anon
  using (true)
  with check (true);
