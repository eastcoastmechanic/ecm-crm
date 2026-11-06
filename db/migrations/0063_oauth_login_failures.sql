-- 0063: failed sign-ins on the OAuth connect page (/api/oauth/authorize), so
-- password guessing is locked out across every server instance. Rows older
-- than a day are deleted by the app. Service role only (RLS on, no policies).
-- Safe to run more than once.
create table if not exists oauth_login_failures (
  id bigint generated always as identity primary key,
  ip text not null,
  created_at timestamptz not null default now()
);

create index if not exists oauth_login_failures_created_at_idx on oauth_login_failures (created_at);
create index if not exists oauth_login_failures_ip_created_at_idx on oauth_login_failures (ip, created_at);

alter table oauth_login_failures enable row level security;
revoke all on oauth_login_failures from anon, authenticated;
