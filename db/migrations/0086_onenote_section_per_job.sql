-- 0086: each new job gets its own OneNote section in the shared "ECM Jobs"
-- notebook: a section group per address, a section per job, and a "Job notes"
-- page in that section. Needs 0066 (OneNote columns) first.
-- Until this is run, OneNote works the old way (a section per address, a page
-- per job, made at the first note). Jobs that already have a page keep it.
-- Additive and safe to re-run.

-- The address's section group in the notebook.
alter table properties add column if not exists onenote_section_group_id text;
-- The job's own section and its link (the Open in OneNote button opens it).
alter table jobs add column if not exists onenote_section_id text;
alter table jobs add column if not exists onenote_section_url text;

-- Check: one row, all true.
select
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'properties' and column_name = 'onenote_section_group_id') as property_group_ready,
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'jobs' and column_name = 'onenote_section_id') as job_section_ready,
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'jobs' and column_name = 'onenote_section_url') as job_section_url_ready;
