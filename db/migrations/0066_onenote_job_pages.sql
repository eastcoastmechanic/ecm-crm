-- 0066: copy job notes to OneNote. One shared "ECM Jobs" notebook in the
-- ecmjobs site, a section per address, a page per job. Needs 0065 (job_notes)
-- first. Additive, safe to run more than once.

-- The owner's Microsoft sign-in for OneNote (one row, id 'onenote'). The
-- refresh token is encrypted by the app before it is stored. Server only.
create table if not exists microsoft_connections (
  id text primary key,
  account text,
  refresh_token_enc text not null,
  connected_by uuid references staff(id) on delete set null,
  connected_at timestamptz not null default now(),
  last_error text,
  site_id text,
  notebook_id text,
  updated_at timestamptz not null default now()
);
alter table microsoft_connections enable row level security;
revoke all on microsoft_connections from anon, authenticated;

alter table properties add column if not exists onenote_section_id text;
alter table jobs add column if not exists onenote_page_id text;
alter table jobs add column if not exists onenote_page_url text;
alter table job_notes add column if not exists onenote_synced_at timestamptz;
-- Set while a copy is in progress; a stale one (10+ minutes) is retried.
alter table job_notes add column if not exists onenote_claimed_at timestamptz;

-- Check: should return 6 rows.
select table_name, column_name from information_schema.columns
where (table_name = 'microsoft_connections' and column_name = 'refresh_token_enc')
   or (table_name = 'properties' and column_name = 'onenote_section_id')
   or (table_name = 'jobs' and column_name in ('onenote_page_id', 'onenote_page_url'))
   or (table_name = 'job_notes' and column_name in ('onenote_synced_at', 'onenote_claimed_at'));
