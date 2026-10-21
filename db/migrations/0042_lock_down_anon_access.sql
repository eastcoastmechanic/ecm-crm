-- 0042_lock_down_anon_access.sql
--
-- WHY: Earlier migrations (0003, 0006, 0008, 0011, 0013, 0016, 0019, 0025,
-- 0029, 0032, 0034, 0036, 0040, 0041, ...) created "internal full access"
-- policies `for all to anon using (true) with check (true)` because the app
-- used to talk to Supabase with the anon key. The public anon key ships in
-- the browser bundle, so anyone holding it can read, edit and delete leads,
-- SMS messages/opt-ins, Square invoices/payments, tasks, inventory, purchase
-- orders, refrigerant logs, survey responses, and objects in the job-photos,
-- diagnostic-photos and document-attachments storage buckets.
--
-- The app no longer needs this: lib/supabase.ts uses the service-role key
-- (bypasses RLS) for all internal and public-form code. The anon key is only
-- used for logged-in sessions (proxy.ts staff lookup, lib/supabase-portal/*),
-- which run as the `authenticated` role.
--
-- WHAT:
--   1. Drop every policy in schema public and on storage.objects that applies
--      to anon. A policy that ALSO lists other roles (e.g. anon+authenticated)
--      is narrowed to those other roles instead of dropped. Policies scoped
--      only to `authenticated` (customer portal, staff_read_own_row) are left
--      alone.
--   2. Revoke table/sequence privileges from anon in public, and change default
--      privileges so new objects are not anon-accessible.
--   3. Make sure RLS stays enabled on every public table (no policy = deny).
--
-- NOT CHANGED: bucket public flags. diagnostic-photos and document-photos are
-- public buckets read via getPublicUrl (PDFs, portal). Public-bucket reads do
-- not go through storage.objects policies, so they keep working.
--
-- Idempotent: safe to run more than once.

do $$
declare
  p record;
  remaining name[];
begin
  for p in
    select schemaname, tablename, policyname, roles
    from pg_policies
    where (schemaname = 'public' or (schemaname = 'storage' and tablename = 'objects'))
      and 'anon' = any(roles)
  loop
    remaining := array_remove(p.roles, 'anon'::name);
    if coalesce(array_length(remaining, 1), 0) = 0 then
      execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
      raise notice 'dropped anon policy % on %.%', p.policyname, p.schemaname, p.tablename;
    else
      execute format('alter policy %I on %I.%I to %s', p.policyname, p.schemaname, p.tablename,
        (select string_agg(quote_ident(r), ', ') from unnest(remaining) r));
      raise notice 'removed anon from policy % on %.% (kept: %)', p.policyname, p.schemaname, p.tablename, remaining;
    end if;
  end loop;

  -- Policies granted to the `public` pseudo-role also reach anon. Not touched
  -- here (could break authenticated flows); surfaced for review.
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where (schemaname = 'public' or (schemaname = 'storage' and tablename = 'objects'))
      and 'public' = any(roles)
  loop
    raise warning 'policy % on %.% applies to role public (includes anon) - review manually', p.policyname, p.schemaname, p.tablename;
  end loop;
end $$;

-- 2. Privileges. RLS is the second line of defence; remove the first-line grant too.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

do $$
begin
  -- Supabase creates objects as supabase_admin too; ignore if we lack rights.
  begin
    alter default privileges for role postgres in schema public revoke all on tables from anon;
    alter default privileges for role postgres in schema public revoke all on sequences from anon;
    alter default privileges for role supabase_admin in schema public revoke all on tables from anon;
    alter default privileges for role supabase_admin in schema public revoke all on sequences from anon;
  exception when others then
    raise notice 'default privileges for other owner roles not changed: %', sqlerrm;
  end;
end $$;

-- 3. Keep RLS enabled everywhere in public.
do $$
declare t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
  loop
    execute format('alter table public.%I enable row level security', t.relname);
    raise notice 'enabled RLS on public.%', t.relname;
  end loop;
end $$;

-- ROLLBACK (manual; only if something unexpectedly depended on anon access).
-- Re-opens the hole, so do it temporarily and fix the caller instead.
--   grant usage on schema public to anon;
--   grant all on all tables in schema public to anon;
--   grant all on all sequences in schema public to anon;
--   alter default privileges in schema public grant all on tables to anon;
--   alter default privileges in schema public grant all on sequences to anon;
-- Then recreate the policies for the affected table, e.g.:
--   create policy "internal full access" on public.leads
--     for all to anon using (true) with check (true);
-- Tables that had one: field_board_events, install_reports, inventory_items,
-- leads, pending_actions, purchase_orders, refrigerant_log, sms_messages,
-- sms_optins, square_invoices, square_payments, survey_responses, tasks (plus
-- any older ones from 0003/0006/0008/0014/0018). Storage:
--   create policy "anon full access job-photos" on storage.objects
--     for all to anon using (bucket_id = 'job-photos') with check (bucket_id = 'job-photos');
-- (same pattern for diagnostic-photos and document-attachments; original
-- definitions are in 0019, 0029 and 0030.)
