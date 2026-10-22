-- Who a job is assigned to. Nullable: unassigned jobs behave exactly as before.
-- The Field Board shows a tech their own jobs first.
alter table jobs
  add column if not exists assigned_staff_id uuid references staff(id) on delete set null;

create index if not exists jobs_assigned_staff_idx on jobs (assigned_staff_id) where assigned_staff_id is not null;
