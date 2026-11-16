-- 0085: one Teams morning brief per channel per New York day.
--
-- app/api/cron/daily-brief claims (day, channel) here before it posts, so a cron retry in
-- the same hour can't post the same card twice. A failed post removes its claim so the
-- next run can try again. ?force=1 test runs don't claim.
--
-- Until this is run, the brief still posts but without the double-post guard.
-- Additive and safe to re-run. Internal only: RLS on, no policies (server uses the service role).

create table if not exists teams_brief_posts (
  date_key date not null,
  channel text not null,
  posted_at timestamptz not null default now(),
  primary key (date_key, channel)
);

alter table teams_brief_posts enable row level security;
revoke all on teams_brief_posts from anon, authenticated;

-- Check: one row, true.
select to_regclass('public.teams_brief_posts') is not null as brief_guard_ready;
