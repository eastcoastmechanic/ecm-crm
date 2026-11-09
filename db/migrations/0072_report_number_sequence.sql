-- 0072: service report numbers (RPT-1001, RPT-1002 ...) that never repeat.
--
-- What was wrong: the CRM picks the next RPT number as "highest RPT number in
-- diagnostics + 1". Two reports started at the same moment both read the same
-- highest number and both get the next one (RPT-1043 twice). Nothing in the
-- database stopped it.
--
-- What this does:
--   1. Lists any RPT numbers already used more than once (read only).
--   2. Adds an 'RPT' counter row to doc_number_counters (the table 0071 made),
--      seeded from the highest RPT number already in diagnostics.
--   3. next_report_number() returns the next free number, e.g. 'RPT-1043'. It
--      locks the RPT counter row, so two reports at once get two different
--      numbers. It also looks at the highest number already in diagnostics, so
--      it never hands out a number older code already used.
--      (next_doc_number() from 0071 reads documents, not diagnostics, so it
--      can't be reused for this.)
--   4. A unique index on diagnostics.doc_number, ONLY if there are no
--      duplicates. If there are, the script does not fail; it skips the index
--      and the last query tells you so.
--
-- Needs 0071 first (doc_number_counters). If 0071 hasn't been run, step 2
-- creates the same table so this still works.
--
-- The CRM code works before and after this runs. Before: highest + 1, as now.
-- After: it uses next_report_number().
--
-- Safe to run more than once. Run the whole file in the Supabase SQL editor.
-- Nothing applies it automatically. The SQL editor shows only the LAST result.
--
-- IF IT REPORTS DUPLICATES (index_created = false):
--   Run the first query on its own to see them. For each number listed, keep
--   the copy the customer has (the older one, or the one that was sent or
--   invoiced) and renumber the other copy, one at a time:
--     update diagnostics set doc_number = next_report_number()
--     where id = '<id of the copy to renumber>';
--   Then run this whole file again.

-- 1. Existing duplicates (read only). Empty result = nothing to fix.
select doc_number,
       count(*) as copies,
       array_agg(id order by created_at) as report_ids_oldest_first
from diagnostics
where doc_number is not null
group by doc_number
having count(*) > 1
order by doc_number;

-- 2. RPT counter, seeded from the highest number in use. Only ever raises it.
create table if not exists doc_number_counters (
  prefix text primary key,
  last_value bigint not null
);
alter table doc_number_counters enable row level security;
revoke all on table doc_number_counters from anon, authenticated;

insert into doc_number_counters (prefix, last_value)
select 'RPT', greatest(coalesce(max((regexp_match(doc_number, '^RPT-([0-9]{1,15})$'))[1]::bigint), 1000), 1000)
from diagnostics
where doc_number like 'RPT-%'
on conflict (prefix) do update
  set last_value = greatest(doc_number_counters.last_value, excluded.last_value);

-- 3. Next free RPT number. First one is RPT-1001.
create or replace function next_report_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing bigint;
  v_next bigint;
begin
  -- Highest number already in diagnostics (rows written before this function
  -- existed). Only a floor.
  select max((regexp_match(doc_number, '^RPT-([0-9]{1,15})$'))[1]::bigint)
    into v_existing
  from diagnostics
  where doc_number like 'RPT-%';

  -- The upsert locks the RPT row; a second caller waits and then sees the
  -- updated value, so two callers never get the same number.
  insert into doc_number_counters as c (prefix, last_value)
  values ('RPT', greatest(coalesce(v_existing, 1000), 1000) + 1)
  on conflict (prefix) do update
    set last_value = greatest(c.last_value, coalesce(v_existing, 0)) + 1
  returning c.last_value into v_next;

  return 'RPT-' || v_next;
end;
$$;

revoke all on function next_report_number() from public;
revoke all on function next_report_number() from anon, authenticated;
grant execute on function next_report_number() to service_role;

-- 4. Unique index, only when there are no duplicates. Does not fail the script.
do $$
begin
  if exists (
    select 1 from diagnostics
    where doc_number is not null
    group by doc_number
    having count(*) > 1
  ) then
    raise notice 'diagnostics has duplicate report numbers. Unique index NOT created. Fix them (see the top of this file) and run it again.';
  else
    create unique index if not exists diagnostics_doc_number_key
      on diagnostics (doc_number)
      where doc_number is not null;
  end if;
end;
$$;

-- Check (this is the result the SQL editor shows):
--   duplicate_numbers = 0, index_created = true, function_ready = true -> done.
--   duplicate_numbers > 0 and index_created = false -> fix duplicates, run again.
select
  (select count(*) from (
     select doc_number from diagnostics
     where doc_number is not null
     group by doc_number having count(*) > 1
   ) d) as duplicate_numbers,
  exists (
    select 1 from pg_indexes
    where tablename = 'diagnostics' and indexname = 'diagnostics_doc_number_key'
  ) as index_created,
  (select last_value from doc_number_counters where prefix = 'RPT') as rpt_last_number,
  exists (select 1 from pg_proc where proname = 'next_report_number') as function_ready;
