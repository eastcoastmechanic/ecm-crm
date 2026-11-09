-- 0076: truck screen offline queue.
--
-- The truck screen saves taps on the phone when there is no signal and sends them when signal
-- comes back. The phone keeps retrying until it hears back, so a job note can arrive twice.
-- Each queued tap carries an id made on the phone (client_action_id); a unique index on it
-- means the second copy of a note is refused by the database and the app treats it as saved.
--
-- Status taps (On my way, I'm here, Finish) need nothing here: they only change a job that is
-- still in the step it was in, so a repeat does nothing.
--
-- Additive and safe to re-run. No data is changed or deleted. Existing notes keep a null
-- client_action_id (nulls never clash in a unique index). The app works before this runs
-- (it then matches a repeat by job, text and time instead).

alter table job_notes add column if not exists client_action_id uuid;

create unique index if not exists job_notes_client_action_id_key
  on job_notes (client_action_id);

-- Check: should return one row, job_notes.client_action_id (uuid), and the index.
select c.column_name, c.data_type, i.indexname
from information_schema.columns c
left join pg_indexes i on i.tablename = 'job_notes' and i.indexname = 'job_notes_client_action_id_key'
where c.table_name = 'job_notes' and c.column_name = 'client_action_id';
