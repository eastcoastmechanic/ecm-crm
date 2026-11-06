-- Text review requests (Phase 4). Run in the Supabase SQL editor.
--
-- After a job is paid (or finished, if it has no CRM invoice), the daily review-requests cron texts the
-- customer a link to the survey page, then one reminder 5 days later if they have not answered.
-- These two columns record what was sent so nothing goes out twice.
--
-- Additive. Existing jobs keep null and the cron only looks at recent ones, so turning this on does
-- not text anyone about old work.

alter table jobs
  add column if not exists review_request_sent_at timestamptz,
  add column if not exists review_reminder_sent_at timestamptz;
