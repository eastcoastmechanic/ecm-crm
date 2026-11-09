-- 0069: shut off automatic post-job follow-ups for certain customers.
--
-- customers.no_followups (default false). When true, two daily crons skip every
-- job for that customer:
--   - review-requests: the survey text and the one reminder
--   - email-reminders sendJobFollowUps: the "how did we do" email
-- Appointment texts, scheduling messages, invoice reminders, and owner alerts
-- are not affected. sms_consent still decides whether any text can go out.
--
-- Additive. Existing customers stay opted in. Safe to run more than once.
-- Run this in the Supabase SQL editor. Nothing applies it automatically.

alter table customers
  add column if not exists no_followups boolean not null default false;

-- Check: one row, data_type = boolean, is_nullable = NO, default false.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_name = 'customers' and column_name = 'no_followups';
