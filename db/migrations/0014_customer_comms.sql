-- Phase 1 of the growth/ops feature batch: customer communication
-- automations. Adds tracking columns for warranty alerts and appointment
-- reminders, a public-facing satisfaction survey, and the columns needed to
-- charge a saved card for recurring maintenance-plan renewals.

alter table equipment add column if not exists warranty_alert_sent_at timestamptz;
alter table jobs add column if not exists appointment_reminder_sent_at timestamptz;

-- documents.last_reminder_sent_at (added in 0004) is reused for estimate
-- follow-ups too — a document is either type='estimate' or type='invoice',
-- never both, so there's no collision between the two reminder flows.

alter table customers add column if not exists stripe_customer_id text;
alter table service_contracts add column if not exists stripe_payment_method_id text;
alter table service_contracts add column if not exists auto_billed_at timestamptz;

create table satisfaction_surveys (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) unique,
  rating int not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

alter table satisfaction_surveys enable row level security;
-- Same "anon full access" shape as every other table (see db/policies.sql) —
-- covers both the internal app's reads and the public survey page's insert,
-- since both currently go through the same anon-key client.
create policy "internal full access" on satisfaction_surveys for all to anon using (true) with check (true);
