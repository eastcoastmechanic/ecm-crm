-- 0065: job notebook (was 0060 in the first draft of #118; 0060 went to review requests).
--
--   job_notes                 : dated notes on one job, with who wrote them. Shown in the Notebook
--                               panel on the Jobs page and on the truck card.
--   properties.files_folder_* : the SharePoint folder for this address (Job Notes / "<street> <town>"
--                               in the ecmjobs site). One folder per address, so a second job at the
--                               same address reuses it. The app creates the folder the first time a
--                               job at that address is created or its Notebook is opened.
--
-- Additive and safe to re-run. No data is changed or deleted.
-- Internal only: RLS on with no anon policy; the server uses the service role (same as 0056).

alter table properties add column if not exists files_folder_url text;
alter table properties add column if not exists files_folder_id text;

create table if not exists job_notes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  author_staff_id uuid references staff(id) on delete set null,
  author_name text,
  body text not null check (length(btrim(body)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists job_notes_job_id_created_at_idx
  on job_notes (job_id, created_at desc);

alter table job_notes enable row level security;
revoke all on job_notes from anon, authenticated;

-- Check: should list job_notes, files_folder_url and files_folder_id.
select table_name, column_name from information_schema.columns
where (table_name = 'job_notes' and column_name = 'body')
   or (table_name = 'properties' and column_name in ('files_folder_url', 'files_folder_id'));
