-- Time tracking on a service report, plus a link to the invoice it produces
-- when a tech marks it finished. Mirrors jobs.tracked_hours (on_way_at ->
-- completed_at) but tracked directly on the report instead of the job,
-- since a job can have zero or one diagnostic and time is logged per visit.
alter table diagnostics add column if not exists time_started_at timestamptz;
alter table diagnostics add column if not exists time_ended_at timestamptz;
alter table diagnostics add column if not exists tracked_hours numeric;
alter table diagnostics add column if not exists completed_at timestamptz;
alter table diagnostics add column if not exists invoice_document_id uuid references documents(id);
