-- Phase: fix tasks table drift. 0013_tasks.sql's `create table tasks (...)`
-- was written assuming a fresh table, but a simpler ad hoc `tasks` table
-- (title/due_date/notes/status/created_by) already existed in production,
-- so 0013 silently failed with "relation already exists" and was never
-- applied. Every piece of code that touches tasks (tasks/actions.ts,
-- tasks/page.tsx, JobsView.tsx, the email-reminders cron, and the internal
-- AI assistant's add_task/list_open_tasks/complete_task tools) has always
-- been built against 0013's intended shape. Bring production in line with
-- it additively — the live table has 0 rows, so nothing to migrate, and
-- the pre-existing due_date/created_by/status columns are left alone
-- rather than dropped.

alter table tasks add column if not exists due_at timestamptz;
alter table tasks add column if not exists customer_id uuid references customers(id);
alter table tasks add column if not exists job_id uuid references jobs(id);
alter table tasks add column if not exists created_via text not null default 'manual';
alter table tasks add column if not exists reminder_sent_at timestamptz;

create index if not exists tasks_due_at_idx on tasks(due_at);
