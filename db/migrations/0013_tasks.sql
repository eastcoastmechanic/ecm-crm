-- Staff to-do list with reminders. Freestanding by default; optionally
-- linked to a customer or job for context. created_via distinguishes
-- manual UI entries from ones the internal AI assistant created.

create table tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  notes text,
  due_at timestamptz,
  completed_at timestamptz,
  reminder_sent_at timestamptz,
  customer_id uuid references customers(id),
  job_id uuid references jobs(id),
  created_via text not null default 'manual', -- manual / ai_chat
  created_at timestamptz not null default now()
);

create index tasks_due_at_idx on tasks(due_at);

alter table tasks enable row level security;
create policy "internal full access" on tasks for all to anon using (true) with check (true);
