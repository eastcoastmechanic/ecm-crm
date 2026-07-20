-- Phase 5: outbound email automation (invoice reminders, contract
-- renewal notices, post-completion follow-ups). These columns let the
-- cron route know what's due and avoid re-sending the same notice.

alter table documents add column if not exists due_date date;
alter table documents add column if not exists last_reminder_sent_at timestamptz;

alter table service_contracts add column if not exists renewal_reminder_sent_at timestamptz;

alter table jobs add column if not exists completed_at timestamptz;
alter table jobs add column if not exists follow_up_sent_at timestamptz;
