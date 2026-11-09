-- 0071: document numbers that never repeat, plus a dashboard money total that
-- can't be cut off at 1000 rows.
--
-- What was wrong: the CRM picked the next number as "how many documents of this
-- type exist + 1001". Delete one document, or create two at the same moment, and
-- the next number is one that is already in use (INV-1003 twice). Nothing in the
-- database stopped it.
--
-- What this does:
--   1. Lists any doc_numbers that are already used more than once (read only).
--   2. doc_number_counters: one counter per prefix (EST, INV, PROP, CON, WTY, PM,
--      CA). Numbers are per prefix today (EST-1001 and INV-1001 both exist), so
--      this is a sequence per prefix. Seeded from the highest number already used.
--   3. next_doc_number('INV') returns the next free number, e.g. 'INV-1043'. It
--      takes a row lock on that prefix's counter, so two creates at once get two
--      different numbers. It also looks at the highest number already in
--      documents, so it never hands out a number older code already used.
--   4. A safety net trigger: if any insert still arrives with a number that is
--      already taken (the Condition Assessment form still counts rows), the
--      trigger swaps in the next free number instead of making a duplicate.
--   5. A unique index on documents.doc_number, ONLY if there are no duplicates.
--      If there are duplicates the script does not fail; it skips the index and
--      the last query tells you so.
--   6. document_money_totals(): the dashboard's Outstanding and Revenue totals as
--      one SQL sum (the page used to add up rows, and silently stopped at 1000).
--
-- The CRM code works before and after this runs. Before: it falls back to the old
-- way of numbering. After: it uses next_doc_number().
--
-- Safe to run more than once. Run the whole file in the Supabase SQL editor.
-- Nothing applies it automatically.
--
-- The SQL editor shows only the LAST result, so the last query repeats the
-- duplicate check together with the index status.
--
-- IF IT REPORTS DUPLICATES (index_created = false):
--   Run the first query on its own to see them. For each doc_number listed, keep
--   the copy the customer has (the older one, or the one that was sent/paid) and
--   give the other copy a new number, one at a time:
--     update documents set doc_number = next_doc_number('INV')
--     where id = '<id of the copy to renumber>';
--   (Use the prefix of that number: EST, INV, PROP, CON, WTY, PM or CA.)
--   Then run this whole file again. It skips what is already done and creates the
--   index once no duplicates are left.

-- 1. Existing duplicates (read only). Empty result = nothing to fix.
select doc_number,
       count(*) as copies,
       array_agg(id order by created_at) as document_ids_oldest_first,
       array_agg(status order by created_at) as statuses_oldest_first
from documents
where doc_number is not null
group by doc_number
having count(*) > 1
order by doc_number;

-- 2. One counter per prefix.
create table if not exists doc_number_counters (
  prefix text primary key,
  last_value bigint not null
);

-- Server code uses the service role. No one else reads or writes this table.
alter table doc_number_counters enable row level security;
revoke all on table doc_number_counters from anon, authenticated;

-- Seed from the highest number already used per prefix. Only ever raises a
-- counter, so a re-run never moves one backwards.
insert into doc_number_counters (prefix, last_value)
select parts[1], max(parts[2]::bigint)
from (
  select regexp_match(doc_number, '^([A-Za-z]{1,10})-([0-9]{1,15})$') as parts
  from documents
  where doc_number is not null
) numbered
where parts is not null
group by parts[1]
on conflict (prefix) do update
  set last_value = greatest(doc_number_counters.last_value, excluded.last_value);

-- 3. Next free number for a prefix. First number for a new prefix is 1001.
create or replace function next_doc_number(p_prefix text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing bigint;
  v_next bigint;
begin
  if p_prefix is null or p_prefix !~ '^[A-Za-z]{1,10}$' then
    raise exception 'next_doc_number: bad prefix %', p_prefix;
  end if;

  -- Highest number already in documents for this prefix, including rows written
  -- by older code that did not use this function. Only a floor.
  select max((regexp_match(doc_number, '^' || p_prefix || '-([0-9]{1,15})$'))[1]::bigint)
    into v_existing
  from documents
  where doc_number like p_prefix || '-%';

  -- The upsert locks this prefix's row; a second caller waits and then sees the
  -- updated value, so two callers never get the same number.
  insert into doc_number_counters as c (prefix, last_value)
  values (p_prefix, greatest(coalesce(v_existing, 1000), 1000) + 1)
  on conflict (prefix) do update
    set last_value = greatest(c.last_value, coalesce(v_existing, 0)) + 1
  returning c.last_value into v_next;

  return p_prefix || '-' || v_next;
end;
$$;

revoke all on function next_doc_number(text) from public;
revoke all on function next_doc_number(text) from anon, authenticated;
grant execute on function next_doc_number(text) to service_role;

-- 4. Safety net: an insert with a number that is already taken gets the next
-- free number instead. Inserts with a fresh number (or no number) are untouched.
create or replace function documents_unique_doc_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
begin
  if new.doc_number is null then
    return new;
  end if;
  if exists (select 1 from documents where doc_number = new.doc_number and id is distinct from new.id) then
    v_prefix := (regexp_match(new.doc_number, '^([A-Za-z]{1,10})-[0-9]{1,15}$'))[1];
    if v_prefix is not null then
      new.doc_number := next_doc_number(v_prefix);
    end if;
  end if;
  return new;
end;
$$;

revoke all on function documents_unique_doc_number() from public;
revoke all on function documents_unique_doc_number() from anon, authenticated;

drop trigger if exists documents_unique_doc_number on documents;
create trigger documents_unique_doc_number
  before insert on documents
  for each row execute function documents_unique_doc_number();

-- 5. Unique index, only when there are no duplicates. Does not fail the script.
do $$
begin
  if exists (
    select 1 from documents
    where doc_number is not null
    group by doc_number
    having count(*) > 1
  ) then
    raise notice 'documents has duplicate doc_numbers. Unique index NOT created. Fix them (see the top of this file) and run it again.';
  else
    create unique index if not exists documents_doc_number_key
      on documents (doc_number)
      where doc_number is not null;
  end if;
end;
$$;

-- 6. Dashboard totals as one sum. Same rules as the page used:
--    Outstanding = invoices with status 'sent'; Revenue = any document 'paid'.
create or replace function document_money_totals()
returns table (outstanding_total numeric, outstanding_count bigint, paid_total numeric)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(total) filter (where type = 'invoice' and status = 'sent'), 0),
    count(*) filter (where type = 'invoice' and status = 'sent'),
    coalesce(sum(total) filter (where status = 'paid'), 0)
  from documents;
$$;

revoke all on function document_money_totals() from public;
revoke all on function document_money_totals() from anon, authenticated;
grant execute on function document_money_totals() to service_role;

-- Check (this is the result the SQL editor shows):
--   duplicate_numbers = 0 and index_created = true  -> done.
--   duplicate_numbers > 0 and index_created = false -> fix duplicates, run again.
--   counters lists each prefix and the last number used.
select
  (select count(*) from (
     select doc_number from documents
     where doc_number is not null
     group by doc_number having count(*) > 1
   ) d) as duplicate_numbers,
  exists (
    select 1 from pg_indexes
    where tablename = 'documents' and indexname = 'documents_doc_number_key'
  ) as index_created,
  (select string_agg(prefix || ' ' || last_value, ', ' order by prefix) from doc_number_counters) as counters,
  exists (select 1 from pg_proc where proname = 'next_doc_number') as next_doc_number_ready,
  exists (select 1 from pg_proc where proname = 'document_money_totals') as money_totals_ready;
