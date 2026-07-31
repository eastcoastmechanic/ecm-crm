-- Phase 6 dispatch notifications: schedule confirmations, "on the way"
-- alerts, 1-hour-before reminders, and time tracking for invoicing.

alter table jobs add column if not exists on_way_at timestamptz;
alter table jobs add column if not exists tracked_hours numeric(6,2);
alter table jobs add column if not exists reminder_sent_at timestamptz;
alter table jobs add column if not exists ics_sequence integer not null default 0;
