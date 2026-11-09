-- 0074: rate limits for the public forms that hold across every server.
--
-- What was wrong: the website forms (text sign-up, book, contact, website
-- chat) only had an in-memory limit, and that memory is per Vercel server.
-- Vercel runs several, so a script could still push thousands of phone
-- numbers into /sms-signup (each one is a paid confirmation text) or flood
-- /book and /contact.
--
-- What this does:
--   1. rate_limit_hits: one row per allowed request. The key never holds a
--      raw phone number, email or IP; the CRM sends a hash
--      (e.g. 'sms-signup:phone:3f2a...').
--   2. rate_limit_hit(key, limit, window_seconds) records the request and
--      returns true if it is allowed, false if that key already used its
--      limit inside the window. A lock per key makes two requests at the same
--      moment count one after the other, so a burst can't slip past the cap.
--      It deletes that key's expired rows each call, and once in a while
--      clears every row older than 2 days.
--   3. Only the CRM server (service_role) can call it or read the table.
--
-- The CRM code works before and after this runs. Before: it falls back to the
-- old per-server memory limit. After: the limits hold across every server.
--
-- Safe to run more than once. Run the whole file in the Supabase SQL editor.
-- Nothing applies it automatically. The SQL editor shows only the LAST result.

-- 1. Table.
create table if not exists rate_limit_hits (
  id bigint generated always as identity primary key,
  key text not null,
  hit_at timestamptz not null default now()
);
create index if not exists rate_limit_hits_key_hit_at_idx on rate_limit_hits (key, hit_at);
create index if not exists rate_limit_hits_hit_at_idx on rate_limit_hits (hit_at);

alter table rate_limit_hits enable row level security;
revoke all on table rate_limit_hits from anon, authenticated;

-- 2. Record a request and say whether it's allowed.
create or replace function rate_limit_hit(p_key text, p_limit int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window interval;
  v_count int;
begin
  if p_key is null or length(p_key) = 0 or length(p_key) > 200 then
    return false;
  end if;
  if p_limit is null or p_limit < 1 then
    return false;
  end if;
  -- Windows from 1 second to 2 days (the cleanup below keeps 2 days).
  v_window := make_interval(secs => least(greatest(coalesce(p_window_seconds, 60), 1), 172800));

  -- One caller per key at a time, until this transaction ends.
  perform pg_advisory_xact_lock(hashtextextended('rate_limit_hit:' || p_key, 0));

  delete from rate_limit_hits where key = p_key and hit_at < now() - v_window;

  select count(*) into v_count from rate_limit_hits where key = p_key;
  if v_count >= p_limit then
    return false;
  end if;

  insert into rate_limit_hits (key) values (p_key);

  -- About 1 call in 100 also clears old rows for every key.
  if random() < 0.01 then
    delete from rate_limit_hits where hit_at < now() - interval '2 days';
  end if;

  return true;
end;
$$;

revoke all on function rate_limit_hit(text, int, int) from public;
revoke all on function rate_limit_hit(text, int, int) from anon, authenticated;
grant execute on function rate_limit_hit(text, int, int) to service_role;

-- Check (this is the result the SQL editor shows):
--   table_ready = true, rls_on = true, function_ready = true,
--   anon_can_call = false -> done.
select
  exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'rate_limit_hits') as table_ready,
  (select relrowsecurity from pg_class where oid = 'public.rate_limit_hits'::regclass) as rls_on,
  exists (select 1 from pg_proc where proname = 'rate_limit_hit') as function_ready,
  has_function_privilege('anon', 'public.rate_limit_hit(text, int, int)', 'execute') as anon_can_call;
