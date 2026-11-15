-- 0084: job log file in the property's SharePoint folder. (Number may need bumping if another
-- PR used 0084 first.) Stands alone: the log just lists no receipts until 0083 runs.
--
--   jobs.log_synced_at : when the job's log file was last written to SharePoint.
--   jobs.log_file_url  : link to that file.
--   jobs.log_failed_at : the owner's "Rebuild job logs" backfill could not write it (it skips
--                        these so one bad job doesn't block the rest; any new event on the job
--                        tries again and clears it).
--
-- Additive and safe to re-run. No data is changed or deleted.

alter table jobs add column if not exists log_synced_at timestamptz;
alter table jobs add column if not exists log_file_url text;
alter table jobs add column if not exists log_failed_at timestamptz;

-- Check: should list the three columns.
select column_name from information_schema.columns
where table_name = 'jobs' and column_name in ('log_synced_at', 'log_file_url', 'log_failed_at');
