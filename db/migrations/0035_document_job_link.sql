-- Links a document back to the job it belongs to. `jobs.document_id` already
-- points the other way (job -> the estimate that spawned it), but nothing
-- points from an invoice back to its job -- so a paid or overdue invoice has
-- no way to find (and move) that job's card in the Planner "Jobs" plan.
--
-- Deliberately a plain nullable FK, not a replacement for jobs.document_id:
-- a job has exactly one originating estimate but can accumulate more than
-- one document over its life (estimate, then a separate invoice, sometimes a
-- warranty doc), so this is the many-documents side of a one-job
-- relationship, not a mirror of the existing column.

alter table documents add column if not exists job_id uuid references jobs(id) on delete set null;

create index if not exists documents_job_idx on documents (job_id) where job_id is not null;
